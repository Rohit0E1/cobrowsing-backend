# Propley Co-browsing Application

A modern WebRTC-based co-browsing and video conferencing application with a Node.js backend and a PostgreSQL database.

## 🚀 Quick Start

### 1. Prerequisites

Ensure you have the following installed on your system:

- **Node.js** (v18 or higher recommended)
- **PostgreSQL** (v14 or higher)

### 2. Installation

Install the project dependencies:

```bash
npm install
```

### 3. Database Configuration

The application uses PostgreSQL. Ensure your database is running and configured correctly.

1. **Start Postgres** (on macOS with Homebrew):
   ```bash
   brew services start postgresql@18
   ```
2. **Setup environment variables**: Create a `.env` file in the root (one has already been created for you) with the following content:
   ```env
   PORT=5001
   DB_USER=sm8uti
   DB_HOST=localhost
   DB_NAME=sm8uti
   DB_PORT=5432
   JWT_SECRET=your_secret_key_here
   ```

### 4. Run the Application

Start the server:

```bash
node index.js
```

The server will start on `http://localhost:5001`.

---

## 🛠 Usage Guide

### 1. Dashboard Access

Open [http://localhost:5001](http://localhost:5001) in your browser.

- **Register**: Create a new account.
- **Login**: Log in with your credentials.

### 2. Start a Meeting

1. Once logged in, click **"Create Meeting Now"** or use the sidebar.
2. Enter the meeting purpose.
3. Go to the **"All Meetings"** tab.
4. You will see two links:
   - **Mod URL**: Use this for the moderator view (includes slide controls and co-browsing tools).
   - **Part URL**: Share this with participants to join the session.

### 3. Features

- **Video/Audio Chat**: Full WebRTC-based real-time communication.
- **Co-browsing**: The moderator can change slides/URLs, and they will sync across all participants.
- **Analytics**: Participant interactions (clicks, joins) are tracked and displayed in the moderator dashboard.

---

## 📂 Project Structure

- `index.js`: Main entry point and Socket.io signaling server.
- `src/config/db.js`: Database configuration and initialization logic.
- `public/`: Frontend assets (Dashboard, Moderator, and Participant views).
- `public/app.js`: Shared WebRTC and conferencing logic.

