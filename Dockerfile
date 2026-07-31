# Use official Node.js image with Debian
FROM node:20-slim

# Install system dependencies required for Electron & Xvfb
RUN apt-get update && apt-get install -y \
    libgtk-3-0 \
    libnss3 \
    libasound2 \
    libgbm1 \
    libxss1 \
    libxtst6 \
    xvfb \
    x11vnc \
    fluxbox \
    dbus \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Set display environment variable for Xvfb
ENV DISPLAY=:99

# Startup script to run Xvfb and start electron
CMD ["sh", "-c", "Xvfb :99 -screen 0 1280x800x24 & npm start"]
