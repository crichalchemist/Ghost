# PrivateStack Deployment Guide - Azure

**Infrastructure:**
- Resource Group: `GHOST-PLATFORM-RG`
- Region: France Central
- Load Balancer: `ghostbusters`
- VMs:
  - `rentfall` (Standard_B4s_v2: 4 vCPUs, 8GB RAM) ← Primary Ghost + MySQL + Redis
  - `slimer-osmosis` (Standard_B2as_v2: 2 vCPUs, 1GB RAM) ← BTCPay Server

## Architecture Overview

```
Internet
    ↓
Load Balancer (ghostbusters)
    ↓
Backend Pool
    ├─→ rentfall (Primary Ghost)
    │   ├─ Ghost CMS (port 2368)
    │   ├─ MySQL (port 3306)
    │   └─ Redis (port 6379)
    │
    └─→ slimer-osmosis (BTCPay Server)
        ├─ BTCPay Server (port 23000)
        └─ PostgreSQL (port 5432)

Note: Both VMs communicate for payment processing:
- rentfall receives webhooks from slimer-osmosis
- Ghost on rentfall creates invoices on slimer-osmosis BTCPay
```

## Deployment Steps

### Phase 1: Prepare rentfall (Primary Ghost VM)

#### 1.1 SSH into rentfall
```bash
# Get public IP
az vm list-ip-addresses -g GHOST-PLATFORM-RG -n rentfall --query "[0].virtualMachine.network.publicIpAddresses[0].ipAddress" -o tsv

# SSH (use the IP from above)
ssh azureuser@<IP_ADDRESS>
```

#### 1.2 Install Docker & Docker Compose
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again for group membership
exit
# ssh back in
```

#### 1.3 Create directory structure
```bash
mkdir -p ~/privatestack/{ghost,btcpay,mysql,redis}
cd ~/privatestack
```

#### 1.4 Create docker-compose.yml for Ghost on rentfall
```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.0
    container_name: ghost-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ghost_production
      MYSQL_USER: ghost
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
    volumes:
      - ./mysql/data:/var/lib/mysql
    networks:
      - ghost-network
    ports:
      - "3306:3306"

  redis:
    image: redis:7-alpine
    container_name: ghost-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASSWORD}
    volumes:
      - ./redis/data:/data
    networks:
      - ghost-network
    ports:
      - "6379:6379"

  ghost:
    image: ghost:5.latest
    container_name: ghost-cms
    restart: unless-stopped
    environment:
      url: https://${GHOST_DOMAIN}
      database__client: mysql
      database__connection__host: mysql
      database__connection__user: ghost
      database__connection__password: ${MYSQL_PASSWORD}
      database__connection__database: ghost_production
      mail__transport: SMTP
      mail__options__service: Mailgun
      mail__options__auth__user: ${MAILGUN_USER}
      mail__options__auth__pass: ${MAILGUN_PASSWORD}
      # BTCPay configuration - points to slimer-osmosis VM
      btcpay__enabled: true
      btcpay__apiUrl: http://${SLIMER_OSMOSIS_PRIVATE_IP}:23000
      btcpay__apiKey: ${BTCPAY_API_KEY}
      btcpay__storeId: ${BTCPAY_STORE_ID}
      btcpay__webhookSecret: ${BTCPAY_WEBHOOK_SECRET}
    volumes:
      - ./ghost/content:/var/lib/ghost/content
      - ./ghost/custom:/var/lib/ghost/content.orig/themes/custom
    networks:
      - ghost-network
    ports:
      - "2368:2368"
    depends_on:
      - mysql
      - redis

networks:
  ghost-network:
    driver: bridge
```

#### 1.5 Create .env file
```bash
cat > .env << 'ENVEOF'
# MySQL
MYSQL_ROOT_PASSWORD=<generate-strong-password>
MYSQL_PASSWORD=<generate-strong-password>

# Redis
REDIS_PASSWORD=<generate-strong-password>

# Domains
GHOST_DOMAIN=yourdomain.com

# Mail (Mailgun or other SMTP)
MAILGUN_USER=postmaster@yourdomain.com
MAILGUN_PASSWORD=<your-mailgun-api-key>

# BTCPay (get these after BTCPay setup on slimer-osmosis)
SLIMER_OSMOSIS_PRIVATE_IP=<internal-ip-of-slimer-osmosis>
BTCPAY_API_KEY=<will-set-after-btcpay-setup>
BTCPAY_STORE_ID=<will-set-after-btcpay-setup>
BTCPAY_WEBHOOK_SECRET=<generate-random-string>
ENVEOF

# Generate secure passwords
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "MYSQL_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "BTCPAY_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
```

### Phase 2: Build Custom Ghost Image

#### 2.1 Copy modified Ghost code to VM
```bash
# On local machine
cd /Volumes/Containers/Ghost

# Create deployment package (excludes node_modules, tests, etc.)
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='test' \
    --exclude='coverage' \
    --exclude='.ghost' \
    -czf ghost-privatestack.tar.gz ghost/

# Copy to VM
scp ghost-privatestack.tar.gz azureuser@<RENTFALL_IP>:~/privatestack/
```

#### 2.2 Build custom Docker image on VM
```bash
# On rentfall VM
cd ~/privatestack
tar -xzf ghost-privatestack.tar.gz

# Create Dockerfile
cat > Dockerfile << 'DOCKEREOF'
FROM ghost:5-alpine

# Copy modified Ghost code
COPY ghost/core /var/lib/ghost
COPY ghost/admin /var/lib/ghost/admin
COPY ghost/i18n /var/lib/ghost/i18n

# Install dependencies
WORKDIR /var/lib/ghost
RUN npm install --production

# Ensure proper permissions
RUN chown -R node:node /var/lib/ghost

USER node

CMD ["node", "index.js"]
DOCKEREOF

# Build image
docker build -t ghost-privatestack:latest .
```

#### 2.3 Update docker-compose.yml
```yaml
  ghost:
    image: ghost-privatestack:latest  # ← Change this line
    # ... rest stays same
```

### Phase 3: Setup slimer-osmosis (BTCPay Server VM)

#### 3.1 SSH into slimer-osmosis
```bash
# Get public IP
az vm list-ip-addresses -g GHOST-PLATFORM-RG -n slimer-osmosis --query "[0].virtualMachine.network.publicIpAddresses[0].ipAddress" -o tsv

# SSH
ssh azureuser@<SLIMER_IP>
```

#### 3.2 Install Docker on slimer-osmosis
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Logout and login again
exit
# ssh back in
```

#### 3.3 Create BTCPay docker-compose on slimer-osmosis
```bash
mkdir -p ~/btcpay
cd ~/btcpay

cat > docker-compose.yml << 'BTCEOF'
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    container_name: btcpay-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: btcpay
      POSTGRES_USER: btcpay
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    networks:
      - btcpay-network
    ports:
      - "5432:5432"

  btcpay:
    image: btcpayserver/btcpayserver:1.13.1
    container_name: btcpay-server
    restart: unless-stopped
    environment:
      BTCPAY_POSTGRES: "User ID=btcpay;Password=${POSTGRES_PASSWORD};Host=postgres;Port=5432;Database=btcpay"
      BTCPAY_NETWORK: testnet
      BTCPAY_CHAINS: "btc"
    volumes:
      - ./btcpay/data:/datadir
    networks:
      - btcpay-network
    ports:
      - "23000:49392"
    depends_on:
      - postgres

networks:
  btcpay-network:
    driver: bridge
BTCEOF

# Create .env for BTCPay
cat > .env << 'ENVEOF'
POSTGRES_PASSWORD=$(openssl rand -base64 32)
ENVEOF
```

#### 3.4 Start BTCPay Server
```bash
docker-compose up -d
docker-compose logs -f btcpay  # Wait for startup
```

#### 3.5 Configure BTCPay
1. Open browser: `http://<SLIMER_PUBLIC_IP>:23000`
2. Create admin account
3. Create store: "Ghost Subscriptions"
4. Settings → Access Tokens → Create new token (with full permissions)
5. Copy API key and Store ID
6. Get slimer-osmosis private IP: `az vm show -g GHOST-PLATFORM-RG -n slimer-osmosis --query "privateIps" -o tsv`

### Phase 4: Start Ghost on rentfall

#### 4.1 Update rentfall .env with BTCPay credentials
```bash
# SSH back to rentfall
ssh azureuser@<RENTFALL_IP>

cd ~/privatestack
nano .env  # Add:
# SLIMER_OSMOSIS_PRIVATE_IP=<private-ip-from-3.5>
# BTCPAY_API_KEY=<api-key-from-3.5>
# BTCPAY_STORE_ID=<store-id-from-3.5>
```

#### 4.2 Start infrastructure services
```bash
docker-compose up -d mysql redis
docker-compose logs -f mysql  # Wait for "ready for connections"
```

#### 4.3 Start Ghost
```bash
docker-compose up -d ghost
docker-compose logs -f ghost  # Check for errors

# Access Ghost at http://<RENTFALL_IP>:2368
```

### Phase 5: Configure Load Balancer

#### 5.1 Add health probe
```bash
az network lb probe create \
  --resource-group GHOST-PLATFORM-RG \
  --lb-name ghostbusters \
  --name ghost-health \
  --protocol http \
  --port 2368 \
  --path /ghost/api/v4/admin/site/
```

#### 5.2 Add load balancing rule
```bash
az network lb rule create \
  --resource-group GHOST-PLATFORM-RG \
  --lb-name ghostbusters \
  --name ghost-http \
  --protocol tcp \
  --frontend-port 80 \
  --backend-port 2368 \
  --frontend-ip-name <FRONTEND_IP_NAME> \
  --backend-pool-name ghostbusters-backendpool01 \
  --probe-name ghost-health
```

### Phase 6: Configure BTCPay Webhooks

#### 6.1 Get Ghost webhook URL
```bash
# Your webhook URL will be:
https://yourdomain.com/members/webhooks/btcpay
```

#### 6.2 Add webhook in BTCPay
1. BTCPay → Store → Settings → Webhooks
2. Add webhook:
   - Payload URL: `https://yourdomain.com/members/webhooks/btcpay`
   - Secret: (value from .env BTCPAY_WEBHOOK_SECRET)
   - Events: InvoiceSettled, InvoiceExpired, InvoiceInvalid
3. Save

## Testing the Deployment

### Test 1: BTCPay Integration
```bash
# Test BTCPay API on slimer-osmosis
curl -X POST http://<SLIMER_PUBLIC_IP>:23000/api/v1/stores/<STORE_ID>/invoices \
  -H "Authorization: token <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": "30",
    "currency": "USD",
    "metadata": {
      "ghost_subscription": true,
      "ghost_annual_membership": true,
      "tier": "annual"
    }
  }'
```

### Test 2: Ghost API
```bash
curl http://<RENTFALL_IP>:2368/ghost/api/v4/admin/site/
```

### Test 3: Webhook Flow
1. Create test invoice in BTCPay
2. Mark as paid (test mode)
3. Check Ghost database for subscription record
4. Verify access token was generated

### Test 4: Bearer Token Access
```bash
# After creating anonymous subscription, get access token from DB (on rentfall)
mysql -h <RENTFALL_PUBLIC_IP> -u ghost -p ghost_production \
  -e "SELECT access_token FROM members_crypto_subscriptions WHERE access_token IS NOT NULL LIMIT 1;"

# Test access URL (Ghost on rentfall)
curl -I http://<RENTFALL_PUBLIC_IP>:2368/members/access/<TOKEN>
```

## Network Configuration

### Ensure VM-to-VM Connectivity
Both VMs need to communicate:
- Ghost on rentfall creates invoices on BTCPay (slimer-osmosis)
- BTCPay on slimer-osmosis sends webhooks to Ghost (rentfall)

```bash
# Check Azure NSG allows traffic between VMs
# Both VMs should be in the same virtual network or have peering

# Get private IPs
az vm show -g GHOST-PLATFORM-RG -n rentfall --query "privateIps" -o tsv
az vm show -g GHOST-PLATFORM-RG -n slimer-osmosis --query "privateIps" -o tsv

# Ensure NSG allows internal traffic on required ports:
# - rentfall needs to reach slimer-osmosis:23000 (BTCPay API)
# - slimer-osmosis needs to reach rentfall:2368 (Ghost webhook)
```

## Security Hardening

### 1. Firewall Rules
```bash
# Azure NSG rules
az network nsg rule create -g GHOST-PLATFORM-RG \
  --nsg-name rentfall-nsg \
  --name AllowHTTP \
  --priority 100 \
  --destination-port-ranges 80 443

az network nsg rule create -g GHOST-PLATFORM-RG \
  --nsg-name rentfall-nsg \
  --name AllowBTCPay \
  --priority 110 \
  --destination-port-ranges 23000
```

### 2. SSL Certificates
```bash
# Install Caddy for automatic SSL
docker run -d -p 80:80 -p 443:443 \
  -v caddy_data:/data \
  -v caddy_config:/config \
  caddy:latest \
  caddy reverse-proxy --from yourdomain.com --to localhost:2368
```

### 3. Backup Strategy
```bash
# Daily MySQL backups
0 2 * * * docker exec ghost-mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} ghost_production > /backup/ghost_$(date +\%Y\%m\%d).sql
```

## Monitoring

### Check service health on rentfall
```bash
# SSH to rentfall
ssh azureuser@<RENTFALL_PUBLIC_IP>
cd ~/privatestack

# Check Ghost services
docker-compose ps
docker-compose logs ghost | tail -50

# Check Ghost database
docker exec -it ghost-mysql mysql -u ghost -p ghost_production \
  -e "SELECT COUNT(*) FROM members_crypto_subscriptions;"
```

### Check BTCPay health on slimer-osmosis
```bash
# SSH to slimer-osmosis
ssh azureuser@<SLIMER_PUBLIC_IP>
cd ~/btcpay

# Check BTCPay services
docker-compose ps
docker-compose logs btcpay | tail -50
```

## Troubleshooting

### Ghost won't start (on rentfall)
```bash
ssh azureuser@<RENTFALL_PUBLIC_IP>
cd ~/privatestack

# Check Ghost logs
docker-compose logs ghost

# Check database connection
docker exec -it ghost-mysql mysql -u ghost -p ghost_production -e "SELECT 1;"

# Check BTCPay connectivity
curl http://<SLIMER_OSMOSIS_PRIVATE_IP>:23000
```

### BTCPay webhooks not working
```bash
# On rentfall: Check if webhook URL is accessible from outside
curl -I https://yourdomain.com/members/webhooks/btcpay

# On rentfall: Check Ghost logs for webhook errors
ssh azureuser@<RENTFALL_PUBLIC_IP>
cd ~/privatestack
docker-compose logs ghost | grep webhook

# On slimer-osmosis: Check BTCPay webhook logs
ssh azureuser@<SLIMER_PUBLIC_IP>
cd ~/btcpay
docker-compose logs btcpay | grep webhook
```

### Anonymous subscriptions not created
```bash
# On slimer-osmosis: Check BTCPay invoice creation
ssh azureuser@<SLIMER_PUBLIC_IP>
cd ~/btcpay
docker-compose logs btcpay | grep invoice

# On rentfall: Check Ghost database
ssh azureuser@<RENTFALL_PUBLIC_IP>
docker exec -it ghost-mysql mysql -u ghost -p ghost_production \
  -e "SELECT * FROM members_crypto_subscriptions ORDER BY created_at DESC LIMIT 5;"
```

### Network connectivity between VMs
```bash
# From rentfall, test connectivity to slimer-osmosis BTCPay
ssh azureuser@<RENTFALL_PUBLIC_IP>
curl http://<SLIMER_OSMOSIS_PRIVATE_IP>:23000

# From slimer-osmosis, test webhook callback to rentfall
ssh azureuser@<SLIMER_PUBLIC_IP>
curl https://yourdomain.com/members/webhooks/btcpay
```
