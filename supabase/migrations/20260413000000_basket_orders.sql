ALTER TABLE reorder_requests
ADD COLUMN IF NOT EXISTS basket_id UUID;

CREATE INDEX IF NOT EXISTS reorder_requests_basket_idx
ON reorder_requests (basket_id)
WHERE basket_id IS NOT NULL;
