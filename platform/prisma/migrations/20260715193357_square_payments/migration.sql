-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "fortePaymethodToken",
DROP COLUMN "forteScheduleId",
DROP COLUMN "forteTransactionId",
ADD COLUMN     "squareCardId" TEXT,
ADD COLUMN     "squareCustomerId" TEXT,
ADD COLUMN     "squareOrderId" TEXT,
ADD COLUMN     "squarePaymentId" TEXT;

