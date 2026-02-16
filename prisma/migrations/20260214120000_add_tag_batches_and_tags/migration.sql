-- CreateTable
CREATE TABLE "tag_batches" (
    "id" SERIAL NOT NULL,
    "prefix" VARCHAR(5) NOT NULL,
    "year_month" VARCHAR(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "batch_seed" INTEGER NOT NULL,
    "prime_multiplier" INTEGER NOT NULL,
    "notes" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "code" VARCHAR(15) NOT NULL,
    "code_compact" VARCHAR(13) NOT NULL,
    "qr_payload" VARCHAR(512) NOT NULL,
    "is_assigned" BOOLEAN NOT NULL DEFAULT false,
    "assigned_dog" INTEGER,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_batches_prefix_key" ON "tag_batches"("prefix");

-- CreateIndex
CREATE INDEX "tag_batches_year_month_sequence_idx" ON "tag_batches"("year_month", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "tags_code_key" ON "tags"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tags_code_compact_key" ON "tags"("code_compact");

-- CreateIndex
CREATE UNIQUE INDEX "tags_batch_id_sequence_key" ON "tags"("batch_id", "sequence");

-- CreateIndex
CREATE INDEX "tags_batch_id_sequence_idx" ON "tags"("batch_id", "sequence");

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "tag_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
