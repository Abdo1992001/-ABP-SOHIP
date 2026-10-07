SELECT 'CREATE DATABASE abp_test OWNER abp'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'abp_test')\gexec
