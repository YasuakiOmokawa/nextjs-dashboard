-- CreateTable
CREATE TABLE "tags2" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "tags2_pkey" PRIMARY KEY ("id")
);
