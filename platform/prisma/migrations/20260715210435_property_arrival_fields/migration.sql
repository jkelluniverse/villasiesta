-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "address" TEXT,
ADD COLUMN     "arrivalNotes" TEXT,
ADD COLUMN     "autoArrival" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "doorCode" TEXT,
ADD COLUMN     "houseRules" TEXT[],
ADD COLUMN     "parkingNotes" TEXT,
ADD COLUMN     "wifiName" TEXT,
ADD COLUMN     "wifiPassword" TEXT;

