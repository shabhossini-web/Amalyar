ALTER TABLE accounts ADD COLUMN phone_verified_at TIMESTAMP(3), ADD COLUMN verification_due_at TIMESTAMP(3);
CREATE INDEX accounts_verification_due_at_idx ON accounts(verification_due_at);
