# Detailed Run Guide

This guide provides step-by-step instructions to run your Propley Co-browsing application from scratch.

### 1. ⚙️ Prerequisites

Before running, make sure the following are installed:

- [Node.js](https://nodejs.org/) (Check with `node -v`)
- [PostgreSQL](https://www.postgresql.org/) (Check with `pg_isready`)

### 2. 📂 Setup and Installation

Navigate to your project folder:

```bash
cd "/Users/sm8uti/Documents/Swoyam Bhai Works/cobrowsing/cobrowsing"
```

Install dependencies:

```bash
npm install
```

### 3. 🗺 Environment Variables

Ensure the following variables are in your `.env` file for the application to function:

```env
PORT=5001
DB_USER=sm8uti
DB_HOST=localhost
DB_NAME=sm8uti
DB_PORT=5432
JWT_SECRET=Propley_private_key
```

### 4. 🗄 Database Initialization

If this is the first time running, Postgres must be active:

- **On Mac (Homebrew)**: `brew services start postgresql@18`
- **On Linux (Systemd)**: `systemctl start postgresql`

The application will **automatically create** the tables on the first run.

### 5. 🚀 Launching the App

To start the server:

```bash
node index.js
```

Now, navigate to:
[http://localhost:5001](http://localhost:5001)

### 6. 📝 Important Steps once launched:

1. **Register** a new account.
2. **Login** to the dashboard.
3. Click **"Create Meeting"** to generate a new meeting room.
4. Copy the **Mod URL** for your view and **Part URL** for others.
