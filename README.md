# todo

This project uses Docker to build and run a Node.js backend and React frontend.
Both services are defined in `docker-compose.yml` along with a PostgreSQL
database.

To start the environment run:

```sh
docker compose up --build
```

This command builds the images and launches the web server container together
with PostgreSQL.
