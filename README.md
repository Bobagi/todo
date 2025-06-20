# To do

A minimalist **Todo List** PWA, containerized with Docker:

- **Backend**: Node.js + Express  
- **Frontend**: React (no build tool) styled via CSS  
- **PWA**: installable, offline-capable (manifest + service worker)  
- **Responsive**: fixed footer on mobile, inline form on desktop  
- **Styling**: dark theme with yellow accents  
- **Database**: PostgreSQL  

## 🚀 Quick Start

```
npm run build
```

- Builds Docker images  
- Starts PostgreSQL with persistent storage  
- Launches the web server (API + PWA)

## ⚙️ Environment Configuration

Create a `.env` file at the root:

```
POSTGRES_USER=todo
POSTGRES_PASSWORD=todo
POSTGRES_DB=todo
WEB_PORT=3051
```

## 🔗 Access

- On desktop: http://localhost:3051  
- On VPS: make sure Nginx proxies to `localhost:${WEB_PORT}` over HTTPS  
- On Codespaces/Gitpod: check web container logs for exposed URL

## 📱 Mobile Behavior

- On small screens (≤768px), the input + Add button are **fixed at the bottom**  
- On desktop, they appear above the task list as normal

## 📁 Project Structure

```
/
├── public/               # Static assets (index.html, manifest.json, icon.png, style.css, service-worker.js)
├── app.js                # React frontend logic
├── server.js             # Express API and static file server
├── .env                  # Database config
├── Dockerfile            # Builds fullstack image
└── docker-compose.yml    # Defines DB + Web services
```

## 📦 PWA Install Support

Install prompt appears when:

- Served via HTTPS or `localhost`  
- Browser criteria are met  
- App isn't already installed (auto-hidden otherwise)

## ⚠️ Notes

This project was initially created with **OpenAI Codex**, but restructured manually to:

- Unify client/server architecture  
- Implement proper PWA behavior  
- Support Docker volumes and PostgreSQL health checks  
- Deliver responsive UX tuned for mobile and desktop
