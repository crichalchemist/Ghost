#!/bin/bash
set -e

echo "🚀 PrivateStack Azure Deployment Helper"
echo "========================================"

# Check if Azure CLI is available
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install it first."
    exit 1
fi

# Get VM IP
echo "📡 Getting rentfall VM IP address..."
RENTFALL_IP=$(az vm list-ip-addresses -g GHOST-PLATFORM-RG -n rentfall \
  --query "[0].virtualMachine.network.publicIpAddresses[0].ipAddress" -o tsv)

if [ -z "$RENTFALL_IP" ]; then
    echo "❌ Could not get rentfall IP. Check your Azure connection."
    exit 1
fi

echo "✅ Found rentfall at: $RENTFALL_IP"

# Create deployment package
echo "📦 Creating deployment package..."
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='test' \
    --exclude='coverage' \
    --exclude='.ghost' \
    --exclude='apps/**/node_modules' \
    -czf ghost-privatestack.tar.gz ghost/

echo "✅ Package created: ghost-privatestack.tar.gz"

# Copy to VM
echo "📤 Copying to VM (this may take a few minutes)..."
scp ghost-privatestack.tar.gz crichalchemist@${RENTFALL_IP}:~/

echo "✅ Files copied!"

# Generate deployment script for VM
cat > vm-setup.sh << 'VMEOF'
#!/bin/bash
set -e

echo "🔧 Setting up PrivateStack on VM..."

# Create directory structure
mkdir -p ~/privatestack/{ghost,btcpay,mysql,redis}
cd ~/privatestack

# Extract Ghost code
tar -xzf ~/ghost-privatestack.tar.gz

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

# Generate secure passwords
MYSQL_ROOT_PW=$(openssl rand -base64 32)
MYSQL_PW=$(openssl rand -base64 32)
REDIS_PW=$(openssl rand -base64 32)
POSTGRES_PW=$(openssl rand -base64 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > .env << ENVEOF
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PW}
MYSQL_PASSWORD=${MYSQL_PW}
REDIS_PASSWORD=${REDIS_PW}
POSTGRES_PASSWORD=${POSTGRES_PW}
BTCPAY_WEBHOOK_SECRET=${WEBHOOK_SECRET}
GHOST_DOMAIN=yourdomain.com
BTCPAY_DOMAIN=btcpay.yourdomain.com
MAILGUN_USER=
MAILGUN_PASSWORD=
BTCPAY_API_KEY=
BTCPAY_STORE_ID=
ENVEOF

echo "✅ Configuration created!"
echo ""
echo "📝 Next steps:"
echo "1. Edit ~/privatestack/.env with your domain names"
echo "2. Install Docker: curl -fsSL https://get.docker.com | sh"
echo "3. Install Docker Compose"
echo "4. Create docker-compose.yml (see DEPLOYMENT_GUIDE.md)"
echo "5. Run: docker-compose up -d"
echo ""
echo "Passwords saved in ~/privatestack/.env"
VMEOF

# Copy setup script to VM
echo "📤 Copying setup script to VM..."
scp vm-setup.sh crichalchemist@${RENTFALL_IP}:~/

# SSH and run setup
echo ""
echo "✅ Files ready on VM!"
echo ""
echo "🔑 To complete deployment, SSH into the VM:"
echo ""
echo "  ssh crichalchemist@${RENTFALL_IP}"
echo ""
echo "Then run:"
echo ""
echo "  chmod +x vm-setup.sh && ./vm-setup.sh"
echo ""
echo "📖 Full deployment guide: DEPLOYMENT_GUIDE.md"
echo ""
