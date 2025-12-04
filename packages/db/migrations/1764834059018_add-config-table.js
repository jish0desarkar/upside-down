/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable("configs", {
    id: "id",
    endpoint: { type: "text", notNull: true },
    name: { type: "text", notNull: true },
    is_active: { type: "bool", notNull: true, default: true },
    expected_status_code: { type: "int", notNull: true, default: 200 },
    check_interval: {
      type: "interval",
      notNull: true,
      default: pgm.func("interval '30 seconds'"),
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("configs", ["endpoint"], { unique: true });
  pgm.createFunction(
    "set_updated_at",
    [],
    { returns: "trigger", language: "plpgsql" },
    `
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    `
  );
  pgm.createTrigger("configs", "update_updated_at_timestamp", {
    when: "AFTER",
    operation: "UPDATE",
    level: "ROW",
    function: "set_updated_at",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTrigger("configs", "update_updated_at_timestamp");
  pgm.dropTable("configs");
};
