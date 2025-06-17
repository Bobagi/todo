# todo

This project uses Docker to build and run a Node.js backend and React frontend.
Both services are defined in `docker-compose.yml` along with a PostgreSQL
database.

The app stores tasks in a PostgreSQL database and exposes a small REST API.
The React frontend is served as a Progressive Web App so it can be installed on
desktop or mobile devices.

To start the environment run:

```sh
docker compose up --build
```

This command builds the images and launches the web server container together
with PostgreSQL.

Once the containers are running, open `http://localhost:3000` in your browser to
access the to-do list interface.
