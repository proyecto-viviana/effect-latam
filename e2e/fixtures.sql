-- Synthetic records in a disposable, local D1 database only.
INSERT INTO users (id, email, name, username, role, created_at, updated_at)
VALUES ('fixture-author', 'fixture@example.invalid', 'Autora de prueba', 'fixture_author', 'member', 1, 1);

WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 25)
INSERT INTO threads (id, forum_slug, title, content, author_id, created_at, updated_at)
SELECT 'fixture-list-' || n, 'errors', 'Pregunta de prueba ' || n, 'Contexto de la pregunta.', 'fixture-author', n, n FROM numbers;

INSERT INTO threads (id, forum_slug, title, content, author_id, created_at, updated_at, reply_count)
VALUES ('fixture-thread', 'effect-gen', 'Una conversación con muchas respuestas', 'Un ejemplo para probar la paginación.', 'fixture-author', 1, 1, 25);
WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 25)
INSERT INTO posts (id, thread_id, content, author_id, created_at, updated_at)
SELECT 'fixture-reply-' || n, 'fixture-thread', 'Respuesta de prueba ' || n, 'fixture-author', n, n FROM numbers;
