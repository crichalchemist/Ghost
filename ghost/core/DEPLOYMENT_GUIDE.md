# PrivateStack Deployment Guide - Azure

**Infrastructure:**
- Resource Group: `GHOST-PLATFORM-RG`
- Region: France Central
- Load Balancer: `ghostbusters`
- VMs:
  - `rentfall` (Standard_B4s_v2: 4 vCPUs, 8GB RAM) ← Ghost + BTCPay
  - `slimer-osmosis` (Standard_B2as_v2: 2 vCPUs, 1GB RAM) ← Ghost replica

## Architecture Overview

```
Internet
    ↓
Load Balancer (ghostbusters)
    ↓
Backend Pool
    ├─→ rentfall (Primary)
    │   ├─ Ghost CMS (port 2368)
    │   ├─ BTCPay Server (port 23000)
    │   ├─ MySQL (port 3306)
    │   └─ Redis (port 6379)
    │
    └─→ slimer-osmosis (Replica)
        └─ Ghost CMS (port 2368)
```

## Deployment Steps

### Phase 1: Prepare rentfall (Primary VM)

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

#### 1.4 Create docker-compose.yml
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

  btcpay:
    image: btcpayserver/btcpayserver:1.13.1
    container_name: btcpay-server
    restart: unless-stopped
    environment:
      BTCPAY_HOST: ${BTCPAY_DOMAIN}
      BTCPAY_PROTOCOL: https
      BTCPAY_ROOTPATH: /
      BTCPAY_POSTGRES: "User ID=postgres;Password=${POSTGRES_PASSWORD};Host=postgres;Port=5432;Database=btcpayserver"
    volumes:
      - ./btcpay/data:/datadir
    networks:
      - ghost-network
    ports:
      - "23000:49392"
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    container_name: btcpay-postgres
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: btcpayserver
    volumes:
      - ./btcpay/postgres:/var/lib/postgresql/data
    networks:
      - ghost-network

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
      # BTCPay configuration
      btcpay__enabled: true
      btcpay__apiUrl: http://btcpay:49392
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

# PostgreSQL (for BTCPay)
POSTGRES_PASSWORD=<generate-strong-password>

# Domains
GHOST_DOMAIN=yourdomain.com
BTCPAY_DOMAIN=btcpay.yourdomain.com

# Mail (Mailgun or other SMTP)
MAILGUN_USER=postmaster@yourdomain.com
MAILGUN_PASSWORD=<your-mailgun-api-key>

# BTCPay (get these after BTCPay setup)
BTCPAY_API_KEY=<will-set-after-btcpay-setup>
BTCPAY_STORE_ID=<will-set-after-btcpay-setup>
BTCPAY_WEBHOOK_SECRET=<generate-random-string>
ENVEOF

# Generate secure passwords
echo "MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "MYSQL_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "REDIS_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env
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

### Phase 3: Launch Services

#### 3.1 Start infrastructure services
```bash
cd ~/privatestack
docker-compose up -d mysql redis postgres
docker-compose logs -f mysql  # Wait for "ready for connections"
```

#### 3.2 Start BTCPay Server
```bash
docker-compose up -d btcpay
docker-compose logs -f btcpay  # Wait for startup

# Access BTCPay at http://<RENTFALL_IP>:23000
# Create account and store
```

#### 3.3 Configure BTCPay
1. Open browser: `http://<RENTFALL_IP>:23000`
2. Create admin account
3. Create store: "Ghost Subscriptions"
4. Settings → Access Tokens → Create new token (with full permissions)
5. Copy API key and Store ID
6. Update `.env` with these values

#### 3.4 Start Ghost
```bash
# Update .env with BTCPay credentials
nano .env  # Add BTCPAY_API_KEY and BTCPAY_STORE_ID

# Start Ghost
docker-compose up -d ghost
docker-compose logs -f ghost  # Check for errors

# Access Ghost at http://<RENTFALL_IP>:2368
```

### Phase 4: Configure Load Balancer

#### 4.1 Add health probe
```bash
az network lb probe create \
  --resource-group GHOST-PLATFORM-RG \
  --lb-name ghostbusters \
  --name ghost-health \
  --protocol http \
  --port 2368 \
  --path /ghost/api/v4/admin/site/
```

#### 4.2 Add load balancing rule
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

### Phase 5: Configure BTCPay Webhooks

#### 5.1 Get Ghost webhook URL
```bash
# Your webhook URL will be:
https://yourdomain.com/members/webhooks/btcpay
```

#### 5.2 Add webhook in BTCPay
1. BTCPay → Store → Settings → Webhooks
2. Add webhook:
   - Payload URL: `https://yourdomain.com/members/webhooks/btcpay`
   - Secret: (value from .env BTCPAY_WEBHOOK_SECRET)
   - Events: InvoiceSettled, InvoiceExpired, InvoiceInvalid
3. Save

### Phase 6: Deploy to slimer-osmosis (Replica)

#### 6.1 Simplified Ghost-only deployment
```bash
# SSH into slimer-osmosis
ssh azureuser@<SLIMER_IP>

# Install Docker (same as 1.2)
# Copy ghost-privatestack.tar.gz
# Create simplified docker-compose.yml (Ghost only, connects to rentfall MySQL)
```

## Testing the Deployment

### Test 1: BTCPay Integration
```bash
curl -X POST http://<RENTFALL_IP>:23000/api/v1/stores/<STORE_ID>/invoices \
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
# After creating anonymous subscription, get access token from DB
mysql -h <RENTFALL_IP> -u ghost -p ghost_production \
  -e "SELECT access_token FROM members_crypto_subscriptions WHERE access_token IS NOT NULL LIMIT 1;"

# Test access URL
curl -I http://<RENTFALL_IP>:2368/members/access/<TOKEN>
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

### Check service health
```bash
docker-compose ps
docker-compose logs ghost | tail -50
docker-compose logs btcpay | tail -50
```

### Check Ghost database
```bash
docker exec -it ghost-mysql mysql -u ghost -p ghost_production \
  -e "SELECT COUNT(*) FROM members_crypto_subscriptions;"
```

## Troubleshooting

### Ghost won't start
```bash
docker-compose logs ghost
# Check database connection
# Check BTCPay configuration
```

### BTCPay webhooks not working
```bash
# Check webhook URL is accessible
curl -I https://yourdomain.com/members/webhooks/btcpay

# Check Ghost logs for webhook errors
docker-compose logs ghost | grep webhook
```

### Anonymous subscriptions not created
```bash
# Check BTCPay webhook logs
docker-compose logs btcpay | grep webhook

# Check Ghost database
docker exec -it ghost-mysql mysql -u ghost -p ghost_production \
  -e "SELECT * FROM members_crypto_subscriptions ORDER BY created_at DESC LIMIT 5;"
```
