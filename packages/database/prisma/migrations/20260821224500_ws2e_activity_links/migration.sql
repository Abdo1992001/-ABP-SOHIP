CREATE TABLE activity_links (
  activity_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(activity_id) ON DELETE CASCADE,
  resource_type_code text NOT NULL,
  resource_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  CONSTRAINT activity_links_unique UNIQUE(activity_id, resource_type_code, resource_id)
);
CREATE INDEX activity_links_resource_type_code_resource_id_idx ON activity_links(resource_type_code, resource_id);
