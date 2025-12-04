/*
  # Add shipping column to sales table

  1. Changes
    - Add shipping column to sales table with default value of 0
    - Add check constraint to ensure shipping is non-negative
*/

ALTER TABLE sales
ADD COLUMN shipping DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (shipping >= 0);