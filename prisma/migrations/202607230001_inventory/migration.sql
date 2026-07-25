-- Inventory ("what's at which place") — the HomeBox-style feature.
--
-- Problem it solves: the same set of belongings lives split across two homes,
-- so "what did I already leave there?" is unanswerable from memory. An item has
-- exactly one current location; moving it is the central operation and is
-- recorded in inv_moves so the last trip can be reviewed.
--
-- Deliberately outside the billing limits (tabs/tasks): the store is frozen.

CREATE TABLE IF NOT EXISTS inv_locations (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(40) NOT NULL,
  position    INTEGER NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_locations_user_lower_name
  ON inv_locations (user_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_inv_locations_user_pos
  ON inv_locations (user_id, position ASC, id ASC);

CREATE TABLE IF NOT EXISTS inv_items (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         varchar(80) NOT NULL,
  category     varchar(24) NOT NULL DEFAULT 'other',
  qty          INTEGER NOT NULL DEFAULT 1,
  notes        varchar(200) NULL,
  -- NULL = the item exists but its place is unknown (e.g. its location was deleted)
  location_id  INTEGER NULL REFERENCES inv_locations(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_items_user_location
  ON inv_items (user_id, location_id, id DESC);

-- Movement history: answers "what did I take last time?"
CREATE TABLE IF NOT EXISTS inv_moves (
  id                bigserial PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id           INTEGER NULL REFERENCES inv_items(id) ON DELETE SET NULL,
  item_name         varchar(80) NOT NULL, -- denormalised so history survives item deletion
  from_location_id  INTEGER NULL REFERENCES inv_locations(id) ON DELETE SET NULL,
  from_name         varchar(40) NULL,
  to_location_id    INTEGER NULL REFERENCES inv_locations(id) ON DELETE SET NULL,
  to_name           varchar(40) NULL,
  moved_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_moves_user_time
  ON inv_moves (user_id, moved_at DESC, id DESC);
