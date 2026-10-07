-- Contact channels hold email addresses.
DELETE FROM contact_channels WHERE channel_type_code <> 'EMAIL';
ALTER TABLE contact_channels
  ADD CONSTRAINT contact_channels_email_only CHECK (channel_type_code = 'EMAIL');
