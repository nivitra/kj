-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "GalleryStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "WorkflowMode" AS ENUM ('SELECT_ONLY', 'SELECT_AND_DOWNLOAD', 'DOWNLOAD_ONLY');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('OFFLINE', 'GATEWAY');

-- CreateEnum
CREATE TYPE "SelectionStatus" AS ENUM ('OPEN', 'SUBMITTED', 'UNLOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('SENT', 'VIEWED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('REGISTERED', 'UPLOADED', 'QUEUED', 'PROCESSING', 'COMPLETE', 'INDEXED', 'PARTIAL', 'REJECTED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "PhotoProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "FaceStatus" AS ENUM ('ACTIVE', 'DELETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FaceSearchStatus" AS ENUM ('CREATED', 'VALIDATING', 'SEARCHING', 'COMPLETED', 'NO_MATCH', 'REJECTED', 'RATE_LIMITED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FaceIndexStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED', 'FAILED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "Studio" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Studio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'STAFF',
    "totpSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "status" TEXT,
    "cognitoSub" TEXT,
    "loginId" TEXT,
    "passwordHash" TEXT,
    "accountStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "storageUsedBytes" BIGINT NOT NULL DEFAULT 0,
    "packageId" TEXT,
    "requestedPackageId" TEXT,
    "paymentTerms" TEXT,
    "paymentTotalDue" DECIMAL(12,2),
    "paymentAmountPaid" DECIMAL(12,2),
    "paymentCurrency" TEXT NOT NULL DEFAULT 'INR',
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "weddingExperience" BOOLEAN NOT NULL DEFAULT false,
    "brideName" TEXT,
    "groomName" TEXT,
    "weddingDate" TIMESTAMP(3),
    "weddingVenue" TEXT,
    "couplePhotoKey" TEXT,
    "weddingCoverKey" TEXT,
    "bookingPhotoKey" TEXT,
    "albumStatus" TEXT,
    "deliveryStatus" TEXT,
    "photographerName" TEXT,
    "cinematographerName" TEXT,
    "weddingNotes" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioProfile" (
    "inquirySettings" JSONB,
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "logoKey" TEXT,
    "coverKey" TEXT,
    "paymentQrKey" TEXT,
    "upiId" TEXT,
    "displayName" TEXT,
    "tagline" TEXT,
    "about" TEXT,
    "welcomeMessage" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "youtube" TEXT,
    "address" TEXT,
    "mapsUrl" TEXT,
    "workingHours" TEXT,
    "themeColor" TEXT DEFAULT '#1A1917',
    "secondaryColor" TEXT DEFAULT '#9A7B4F',
    "appTheme" TEXT NOT NULL DEFAULT 'warm',
    "appThemeMode" TEXT NOT NULL DEFAULT 'system',
    "termsHtml" TEXT,
    "privacyHtml" TEXT,
    "refundHtml" TEXT,
    "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackage" (
    "eventType" TEXT NOT NULL DEFAULT 'GENERAL',
    "details" JSONB NOT NULL DEFAULT '{}',
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverKey" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountPrice" DECIMAL(12,2),
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bookingSteps" JSONB NOT NULL DEFAULT '[]',
    "includedPhotos" INTEGER,
    "pricePerExtraPhoto" DECIMAL(10,2),
    "pricePerExtraRaw" DECIMAL(10,2),
    "pricePerExtraEdited" DECIMAL(10,2),
    "workflowMode" TEXT NOT NULL DEFAULT 'SELECT_ONLY',
    "selectionTierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicePackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServicePackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioItem" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverKey" TEXT,
    "mediaKey" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "externalUrl" TEXT,
    "category" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioMedia" (
    "id" TEXT NOT NULL,
    "portfolioItemId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageKey" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "style" TEXT NOT NULL DEFAULT 'FEED',
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBooking" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "servicePackageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ENQUIRY_RECEIVED',
    "notes" TEXT,
    "estimatedCompletion" TIMESTAMP(3),
    "confirmedDate" TIMESTAMP(3),
    "confirmedTime" TEXT,
    "confirmedLeadId" TEXT,
    "requestedDate" TIMESTAMP(3),
    "requestedTime" TEXT,
    "slotStatus" TEXT NOT NULL DEFAULT 'NONE',
    "rescheduleNote" TEXT,
    "rescheduleRequestedAt" TIMESTAMP(3),
    "history" JSONB NOT NULL DEFAULT '[]',
    "jobs" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
    "discountValue" DECIMAL(12,2) NOT NULL,
    "minOrderAmount" DECIMAL(12,2),
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "packageIds" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "invoiceId" TEXT,
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "amountSaved" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orderAmount" DECIMAL(12,2),
    "packageId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Service Invoice',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT NOT NULL DEFAULT 'INVOICE',
    "parentInvoiceId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "travelAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cachedOutstanding" DECIMAL(12,2),
    "notes" TEXT,
    "terms" TEXT,
    "couponCode" TEXT,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxLabel" TEXT,
    "packageSnapshot" JSONB,
    "customerGstin" TEXT,
    "studioGstin" TEXT,
    "issuedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'CUSTOM',
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "unitAmount" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "hsnCode" TEXT,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceInstallment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL,
    "percentage" DECIMAL(5,2),
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "installmentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" TEXT,
    "idempotencyKey" TEXT,
    "gatewayProvider" TEXT,
    "gatewayRef" TEXT,
    "gatewayStatus" TEXT,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "pdfKey" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceRevision" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "InvoiceRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT,
    "packageId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "formData" JSONB,
    "source" TEXT NOT NULL DEFAULT 'ENQUIRE',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "inquiryKind" TEXT NOT NULL DEFAULT 'GENERAL',
    "inquiryStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedDate" TIMESTAMP(3),
    "requestedTime" TEXT,
    "slotStatus" TEXT NOT NULL DEFAULT 'NONE',
    "confirmedDate" TIMESTAMP(3),
    "confirmedTime" TEXT,
    "rescheduleNote" TEXT,
    "rescheduleRequestedAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorAdminId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientType" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "basePrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "workflowMode" "WorkflowMode" NOT NULL DEFAULT 'SELECT_ONLY',
    "paymentMode" "PaymentMode" NOT NULL DEFAULT 'OFFLINE',
    "includedPhotos" INTEGER,
    "pricePerExtraPhoto" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingSettings" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "includedPhotos" INTEGER NOT NULL DEFAULT 0,
    "pricePerExtraPhoto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "baseGalleryFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "watermarkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "faceSearchThreshold" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FrameProduct" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "size" TEXT,
    "material" TEXT,
    "imageKey" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FrameProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGallery" (
    "pricingSnapshot" JSONB,
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "clientTypeId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "eventDate" TIMESTAMP(3),
    "coverPhotoUrl" TEXT,
    "status" "GalleryStatus" NOT NULL DEFAULT 'DRAFT',
    "downloadEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paymentComplete" BOOLEAN NOT NULL DEFAULT false,
    "watermarkEnabled" BOOLEAN,
    "uploadQuality" INTEGER,
    "faceSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "faceSearchThreshold" DOUBLE PRECISION,
    "faceIndexStatus" "FaceIndexStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "purpose" TEXT NOT NULL DEFAULT 'GENERAL',
    "selectionEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selectionLimit" INTEGER,
    "extraPhotoPrice" DECIMAL(10,2),
    "coverPhotoId" TEXT,
    "coverCrop" JSONB,
    "bulkRawEnabled" BOOLEAN NOT NULL DEFAULT false,
    "bulkRawPrice" DECIMAL(12,2),
    "bulkRawWindowDays" INTEGER NOT NULL DEFAULT 14,
    "bulkRawInvoiceId" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "deletedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventGallery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "createdByCustomerId" TEXT,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "fullAccessCodeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GalleryGuest" (
    "id" TEXT NOT NULL,
    "shareLinkId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "customerId" TEXT,
    "faceSessionId" TEXT,
    "fullAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GalleryGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "thumbnailKey" TEXT,
    "previewKey" TEXT,
    "mediaType" TEXT NOT NULL DEFAULT 'IMAGE',
    "posterKey" TEXT,
    "durationMs" INTEGER,
    "filename" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sha256" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "ingestionStatus" "IngestionStatus" NOT NULL DEFAULT 'REGISTERED',
    "processingStatus" "PhotoProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastErrorMessageSafe" TEXT,
    "rekognitionIndexedAt" TIMESTAMP(3),
    "faceIndexed" BOOLEAN NOT NULL DEFAULT false,
    "isVisibleToCustomers" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "rawInvoiceId" TEXT,
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "token" TEXT,
    "rawAccess" BOOLEAN NOT NULL DEFAULT false,
    "rawGrantedAt" TIMESTAMP(3),
    "rawGrantedByAdminId" TEXT,
    "accessMode" TEXT NOT NULL DEFAULT 'SELECTION',
    "selectionLimit" INTEGER,
    "extraPhotoPrice" DECIMAL(10,2),
    "downloadEnabled" BOOLEAN,
    "faceSearchEnabled" BOOLEAN,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "status" "SelectionStatus" NOT NULL DEFAULT 'OPEN',
    "submittedAt" TIMESTAMP(3),
    "customerNote" TEXT,
    "adminNote" TEXT,
    "history" JSONB NOT NULL DEFAULT '[]',
    "includedLimit" INTEGER,
    "extraCount" INTEGER NOT NULL DEFAULT 0,
    "extraUnitPrice" DECIMAL(10,2),
    "overageAmount" DECIMAL(12,2),
    "overageInvoiceId" TEXT,
    "overageSyncedAt" TIMESTAMP(3),
    "deliveryStatus" TEXT NOT NULL DEFAULT 'NONE',
    "rawCount" INTEGER NOT NULL DEFAULT 0,
    "editedCount" INTEGER NOT NULL DEFAULT 0,
    "freeCount" INTEGER NOT NULL DEFAULT 0,
    "rawExtraCount" INTEGER NOT NULL DEFAULT 0,
    "editedExtraCount" INTEGER NOT NULL DEFAULT 0,
    "rawUnitPrice" DECIMAL(10,2),
    "editedUnitPrice" DECIMAL(10,2),
    "classifiedAt" TIMESTAMP(3),
    "billedAt" TIMESTAMP(3),
    "adminOpenedAt" TIMESTAMP(3),
    "editingStartedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB,
    "includedLockedAt" TIMESTAMP(3),
    "unlockMode" TEXT NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelectionItem" (
    "editingStartedAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "selectionId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "galleryId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PLACED',
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "customerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "frameProductId" TEXT NOT NULL,
    "photoId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "galleryId" TEXT,
    "orderId" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "gatewayRef" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "galleryId" TEXT,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedFromIp" TEXT,
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "formData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeddingAgreement" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Wedding Service Agreement',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "formData" JSONB NOT NULL DEFAULT '{}',
    "pdfKey" TEXT,
    "fileSize" INTEGER,
    "contractId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeddingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteOption" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "crewJson" JSONB NOT NULL DEFAULT '[]',
    "deliverablesJson" JSONB NOT NULL DEFAULT '[]',
    "appAccessMonths" INTEGER NOT NULL DEFAULT 3,
    "deliveryWeeksMin" INTEGER NOT NULL DEFAULT 4,
    "deliveryWeeksMax" INTEGER NOT NULL DEFAULT 5,
    "price" DECIMAL(12,2) NOT NULL,
    "servicePackageId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteAddOn" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "specsJson" JSONB NOT NULL DEFAULT '[]',
    "price" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "leadId" TEXT,
    "agreementId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Photography quotation',
    "eventType" TEXT NOT NULL DEFAULT 'WEDDING',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "clientName" TEXT,
    "eventDate" TIMESTAMP(3),
    "venue" TEXT,
    "overview" TEXT,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "pricingSnapshot" JSONB NOT NULL DEFAULT '{}',
    "pdfKey" TEXT,
    "fileSize" INTEGER,
    "sentAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoFace" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "rekognitionFaceId" TEXT NOT NULL,
    "externalImageId" TEXT NOT NULL,
    "boundingBox" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "pose" JSONB,
    "quality" JSONB,
    "userProfileId" TEXT,
    "faceStatus" "FaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoFace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSearchSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "galleryId" TEXT,
    "customerId" TEXT NOT NULL,
    "consentId" TEXT,
    "selfieKey" TEXT,
    "status" "FaceSearchStatus" NOT NULL DEFAULT 'CREATED',
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 95,
    "searchedFaceCount" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "safeFailureCode" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceSearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceSearchMatch" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "photoFaceId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "includedInResult" BOOLEAN NOT NULL DEFAULT true,
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceSearchMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "consentType" TEXT NOT NULL DEFAULT 'face_search',
    "policyVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,
    "userAgentHash" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
    "id" TEXT NOT NULL,
    "studioId" TEXT,
    "galleryId" TEXT,
    "photoId" TEXT,
    "sessionId" TEXT,
    "jobType" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastErrorCode" TEXT,
    "lastErrorMessageSafe" TEXT,
    "payload" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceIndexJob" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "status" "FaceIndexStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceIndexJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "galleryId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppSession" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "lastQrAt" TIMESTAMP(3),
    "lastConnectedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "autoSendEnabled" BOOLEAN NOT NULL DEFAULT true,
    "typingMinMs" INTEGER NOT NULL DEFAULT 15000,
    "typingMaxMs" INTEGER NOT NULL DEFAULT 20000,
    "dailyTouchpointLimit" INTEGER NOT NULL DEFAULT 80,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "trigger" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessageLog" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateKey" TEXT,
    "campaignId" TEXT,
    "toPhone" TEXT NOT NULL,
    "toName" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "meta" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCampaign" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "name" TEXT,
    "templateId" TEXT,
    "templateKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WhatsAppCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSequence" (
    "studioId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "BillingSequence_pkey" PRIMARY KEY ("studioId","year")
);

-- CreateTable
CREATE TABLE "PaymentClaim" (
    "id" TEXT NOT NULL,
    "studioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Studio_email_key" ON "Studio"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_studioId_idx" ON "AdminUser"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_cognitoSub_key" ON "Customer"("cognitoSub");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_loginId_key" ON "Customer"("loginId");

-- CreateIndex
CREATE INDEX "Customer_studioId_idx" ON "Customer"("studioId");

-- CreateIndex
CREATE INDEX "Customer_packageId_idx" ON "Customer"("packageId");

-- CreateIndex
CREATE INDEX "Customer_requestedPackageId_idx" ON "Customer"("requestedPackageId");

-- CreateIndex
CREATE INDEX "Customer_accountStatus_idx" ON "Customer"("accountStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_studioId_email_key" ON "Customer"("studioId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_studioId_phone_key" ON "Customer"("studioId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "StudioProfile_studioId_key" ON "StudioProfile"("studioId");

-- CreateIndex
CREATE INDEX "ServicePackage_studioId_active_displayOrder_idx" ON "ServicePackage"("studioId", "active", "displayOrder");

-- CreateIndex
CREATE INDEX "ServicePackage_selectionTierId_idx" ON "ServicePackage"("selectionTierId");

-- CreateIndex
CREATE INDEX "ServicePackageFeature_packageId_displayOrder_idx" ON "ServicePackageFeature"("packageId", "displayOrder");

-- CreateIndex
CREATE INDEX "PortfolioItem_studioId_active_displayOrder_idx" ON "PortfolioItem"("studioId", "active", "displayOrder");

-- CreateIndex
CREATE INDEX "PortfolioItem_studioId_category_idx" ON "PortfolioItem"("studioId", "category");

-- CreateIndex
CREATE INDEX "PortfolioMedia_portfolioItemId_sortOrder_idx" ON "PortfolioMedia"("portfolioItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "Announcement_studioId_active_priority_idx" ON "Announcement"("studioId", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBooking_customerId_key" ON "CustomerBooking"("customerId");

-- CreateIndex
CREATE INDEX "CustomerBooking_studioId_idx" ON "CustomerBooking"("studioId");

-- CreateIndex
CREATE INDEX "CustomerBooking_status_idx" ON "CustomerBooking"("status");

-- CreateIndex
CREATE INDEX "CustomerBooking_slotStatus_idx" ON "CustomerBooking"("slotStatus");

-- CreateIndex
CREATE INDEX "CustomerBooking_servicePackageId_idx" ON "CustomerBooking"("servicePackageId");

-- CreateIndex
CREATE INDEX "Coupon_studioId_active_idx" ON "Coupon"("studioId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_studioId_code_key" ON "Coupon"("studioId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_invoiceId_key" ON "CouponRedemption"("invoiceId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_idx" ON "CouponRedemption"("couponId");

-- CreateIndex
CREATE INDEX "CouponRedemption_customerId_idx" ON "CouponRedemption"("customerId");

-- CreateIndex
CREATE INDEX "CouponRedemption_studioId_idx" ON "CouponRedemption"("studioId");

-- CreateIndex
CREATE INDEX "Invoice_studioId_status_idx" ON "Invoice"("studioId", "status");

-- CreateIndex
CREATE INDEX "Invoice_studioId_customerId_idx" ON "Invoice"("studioId", "customerId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_parentInvoiceId_idx" ON "Invoice"("parentInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_studioId_invoiceNumber_key" ON "Invoice"("studioId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_sortOrder_idx" ON "InvoiceLineItem"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "InvoiceInstallment_invoiceId_sortOrder_idx" ON "InvoiceInstallment"("invoiceId", "sortOrder");

-- CreateIndex
CREATE INDEX "InvoiceInstallment_dueDate_idx" ON "InvoiceInstallment"("dueDate");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_paidAt_idx" ON "InvoicePayment"("invoiceId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_studioId_paidAt_idx" ON "InvoicePayment"("studioId", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_studioId_method_paidAt_idx" ON "InvoicePayment"("studioId", "method", "paidAt");

-- CreateIndex
CREATE INDEX "InvoicePayment_installmentId_idx" ON "InvoicePayment"("installmentId");

-- CreateIndex
CREATE INDEX "Receipt_invoiceId_idx" ON "Receipt"("invoiceId");

-- CreateIndex
CREATE INDEX "Receipt_paymentId_idx" ON "Receipt"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_studioId_receiptNumber_key" ON "Receipt"("studioId", "receiptNumber");

-- CreateIndex
CREATE INDEX "InvoiceRevision_invoiceId_idx" ON "InvoiceRevision"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRevision_invoiceId_revision_key" ON "InvoiceRevision"("invoiceId", "revision");

-- CreateIndex
CREATE INDEX "Lead_studioId_status_createdAt_idx" ON "Lead"("studioId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_studioId_slotStatus_createdAt_idx" ON "Lead"("studioId", "slotStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_studioId_inquiryKind_inquiryStatus_createdAt_idx" ON "Lead"("studioId", "inquiryKind", "inquiryStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_customerId_idx" ON "Lead"("customerId");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_idx" ON "LeadNote"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientType_studioId_idx" ON "ClientType"("studioId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientType_studioId_slug_key" ON "ClientType"("studioId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PricingSettings_studioId_key" ON "PricingSettings"("studioId");

-- CreateIndex
CREATE INDEX "FrameProduct_studioId_idx" ON "FrameProduct"("studioId");

-- CreateIndex
CREATE INDEX "EventGallery_studioId_idx" ON "EventGallery"("studioId");

-- CreateIndex
CREATE INDEX "EventGallery_status_idx" ON "EventGallery"("status");

-- CreateIndex
CREATE INDEX "EventGallery_studioId_deletedAt_idx" ON "EventGallery"("studioId", "deletedAt");

-- CreateIndex
CREATE INDEX "EventGallery_purgeAt_idx" ON "EventGallery"("purgeAt");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryShareLink_token_key" ON "GalleryShareLink"("token");

-- CreateIndex
CREATE INDEX "GalleryShareLink_galleryId_idx" ON "GalleryShareLink"("galleryId");

-- CreateIndex
CREATE INDEX "GalleryShareLink_studioId_idx" ON "GalleryShareLink"("studioId");

-- CreateIndex
CREATE INDEX "GalleryShareLink_token_idx" ON "GalleryShareLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "GalleryGuest_sessionToken_key" ON "GalleryGuest"("sessionToken");

-- CreateIndex
CREATE INDEX "GalleryGuest_shareLinkId_idx" ON "GalleryGuest"("shareLinkId");

-- CreateIndex
CREATE INDEX "GalleryGuest_galleryId_idx" ON "GalleryGuest"("galleryId");

-- CreateIndex
CREATE INDEX "GalleryGuest_studioId_phone_idx" ON "GalleryGuest"("studioId", "phone");

-- CreateIndex
CREATE INDEX "GalleryGuest_sessionToken_idx" ON "GalleryGuest"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_originalKey_key" ON "Photo"("originalKey");

-- CreateIndex
CREATE INDEX "Photo_galleryId_idx" ON "Photo"("galleryId");

-- CreateIndex
CREATE INDEX "Photo_galleryId_mediaType_idx" ON "Photo"("galleryId", "mediaType");

-- CreateIndex
CREATE INDEX "Photo_galleryId_ingestionStatus_idx" ON "Photo"("galleryId", "ingestionStatus");

-- CreateIndex
CREATE INDEX "Photo_galleryId_filename_idx" ON "Photo"("galleryId", "filename");

-- CreateIndex
CREATE INDEX "Photo_processingStatus_idx" ON "Photo"("processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_galleryId_sha256_key" ON "Photo"("galleryId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_token_key" ON "AccessGrant"("token");

-- CreateIndex
CREATE INDEX "AccessGrant_customerId_idx" ON "AccessGrant"("customerId");

-- CreateIndex
CREATE INDEX "AccessGrant_galleryId_idx" ON "AccessGrant"("galleryId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_customerId_galleryId_key" ON "AccessGrant"("customerId", "galleryId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_customerId_photoId_key" ON "Favorite"("customerId", "photoId");

-- CreateIndex
CREATE INDEX "Selection_galleryId_idx" ON "Selection"("galleryId");

-- CreateIndex
CREATE INDEX "Selection_status_idx" ON "Selection"("status");

-- CreateIndex
CREATE INDEX "Selection_overageInvoiceId_idx" ON "Selection"("overageInvoiceId");

-- CreateIndex
CREATE INDEX "Selection_deliveryStatus_idx" ON "Selection"("deliveryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Selection_customerId_galleryId_key" ON "Selection"("customerId", "galleryId");

-- CreateIndex
CREATE INDEX "SelectionItem_selectionId_deliveryType_idx" ON "SelectionItem"("selectionId", "deliveryType");

-- CreateIndex
CREATE INDEX "SelectionItem_selectionId_batchNumber_idx" ON "SelectionItem"("selectionId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SelectionItem_selectionId_photoId_key" ON "SelectionItem"("selectionId", "photoId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE INDEX "Order_studioId_idx" ON "Order"("studioId");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Payment_studioId_idx" ON "Payment"("studioId");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE INDEX "Contract_studioId_idx" ON "Contract"("studioId");

-- CreateIndex
CREATE INDEX "Contract_customerId_idx" ON "Contract"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "WeddingAgreement_contractId_key" ON "WeddingAgreement"("contractId");

-- CreateIndex
CREATE INDEX "WeddingAgreement_studioId_customerId_idx" ON "WeddingAgreement"("studioId", "customerId");

-- CreateIndex
CREATE INDEX "WeddingAgreement_status_idx" ON "WeddingAgreement"("status");

-- CreateIndex
CREATE INDEX "QuoteOption_studioId_active_displayOrder_idx" ON "QuoteOption"("studioId", "active", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteOption_studioId_code_key" ON "QuoteOption"("studioId", "code");

-- CreateIndex
CREATE INDEX "QuoteAddOn_studioId_active_idx" ON "QuoteAddOn"("studioId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteAddOn_studioId_code_key" ON "QuoteAddOn"("studioId", "code");

-- CreateIndex
CREATE INDEX "Quote_studioId_customerId_status_idx" ON "Quote"("studioId", "customerId", "status");

-- CreateIndex
CREATE INDEX "Quote_leadId_idx" ON "Quote"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoFace_rekognitionFaceId_key" ON "PhotoFace"("rekognitionFaceId");

-- CreateIndex
CREATE INDEX "PhotoFace_galleryId_rekognitionFaceId_idx" ON "PhotoFace"("galleryId", "rekognitionFaceId");

-- CreateIndex
CREATE INDEX "PhotoFace_photoId_idx" ON "PhotoFace"("photoId");

-- CreateIndex
CREATE INDEX "PhotoFace_galleryId_faceStatus_idx" ON "PhotoFace"("galleryId", "faceStatus");

-- CreateIndex
CREATE INDEX "FaceSearchSession_customerId_createdAt_idx" ON "FaceSearchSession"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "FaceSearchSession_status_expiresAt_idx" ON "FaceSearchSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "FaceSearchMatch_sessionId_rank_idx" ON "FaceSearchMatch"("sessionId", "rank");

-- CreateIndex
CREATE INDEX "FaceSearchMatch_photoId_idx" ON "FaceSearchMatch"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "FaceSearchMatch_sessionId_photoFaceId_key" ON "FaceSearchMatch"("sessionId", "photoFaceId");

-- CreateIndex
CREATE INDEX "ConsentRecord_customerId_idx" ON "ConsentRecord"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingJob_idempotencyKey_key" ON "ProcessingJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProcessingJob_status_idx" ON "ProcessingJob"("status");

-- CreateIndex
CREATE INDEX "ProcessingJob_galleryId_idx" ON "ProcessingJob"("galleryId");

-- CreateIndex
CREATE INDEX "ProcessingJob_jobType_status_idx" ON "ProcessingJob"("jobType", "status");

-- CreateIndex
CREATE INDEX "FaceIndexJob_galleryId_idx" ON "FaceIndexJob"("galleryId");

-- CreateIndex
CREATE INDEX "AuditLog_adminId_idx" ON "AuditLog"("adminId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_studioId_key" ON "WhatsAppSession"("studioId");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_studioId_active_idx" ON "WhatsAppTemplate"("studioId", "active");

-- CreateIndex
CREATE INDEX "WhatsAppTemplate_studioId_trigger_idx" ON "WhatsAppTemplate"("studioId", "trigger");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_studioId_key_key" ON "WhatsAppTemplate"("studioId", "key");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_studioId_createdAt_idx" ON "WhatsAppMessageLog"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_studioId_status_idx" ON "WhatsAppMessageLog"("studioId", "status");

-- CreateIndex
CREATE INDEX "WhatsAppMessageLog_campaignId_idx" ON "WhatsAppMessageLog"("campaignId");

-- CreateIndex
CREATE INDEX "WhatsAppCampaign_studioId_createdAt_idx" ON "WhatsAppCampaign"("studioId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentClaim_studioId_status_idx" ON "PaymentClaim"("studioId", "status");

-- CreateIndex
CREATE INDEX "PaymentClaim_invoiceId_idx" ON "PaymentClaim"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentClaim_studioId_reference_key" ON "PaymentClaim"("studioId", "reference");

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ClientType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_requestedPackageId_fkey" FOREIGN KEY ("requestedPackageId") REFERENCES "ClientType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioProfile" ADD CONSTRAINT "StudioProfile_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackage" ADD CONSTRAINT "ServicePackage_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicePackageFeature" ADD CONSTRAINT "ServicePackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioMedia" ADD CONSTRAINT "PortfolioMedia_portfolioItemId_fkey" FOREIGN KEY ("portfolioItemId") REFERENCES "PortfolioItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBooking" ADD CONSTRAINT "CustomerBooking_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBooking" ADD CONSTRAINT "CustomerBooking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBooking" ADD CONSTRAINT "CustomerBooking_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_parentInvoiceId_fkey" FOREIGN KEY ("parentInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceInstallment" ADD CONSTRAINT "InvoiceInstallment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "InvoiceInstallment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "InvoicePayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRevision" ADD CONSTRAINT "InvoiceRevision_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientType" ADD CONSTRAINT "ClientType_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingSettings" ADD CONSTRAINT "PricingSettings_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FrameProduct" ADD CONSTRAINT "FrameProduct_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGallery" ADD CONSTRAINT "EventGallery_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGallery" ADD CONSTRAINT "EventGallery_clientTypeId_fkey" FOREIGN KEY ("clientTypeId") REFERENCES "ClientType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryShareLink" ADD CONSTRAINT "GalleryShareLink_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryShareLink" ADD CONSTRAINT "GalleryShareLink_createdByCustomerId_fkey" FOREIGN KEY ("createdByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GalleryGuest" ADD CONSTRAINT "GalleryGuest_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "GalleryShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Selection" ADD CONSTRAINT "Selection_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionItem" ADD CONSTRAINT "SelectionItem_selectionId_fkey" FOREIGN KEY ("selectionId") REFERENCES "Selection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelectionItem" ADD CONSTRAINT "SelectionItem_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_frameProductId_fkey" FOREIGN KEY ("frameProductId") REFERENCES "FrameProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeddingAgreement" ADD CONSTRAINT "WeddingAgreement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOption" ADD CONSTRAINT "QuoteOption_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteOption" ADD CONSTRAINT "QuoteOption_servicePackageId_fkey" FOREIGN KEY ("servicePackageId") REFERENCES "ServicePackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteAddOn" ADD CONSTRAINT "QuoteAddOn_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "WeddingAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoFace" ADD CONSTRAINT "PhotoFace_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSearchSession" ADD CONSTRAINT "FaceSearchSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceSearchMatch" ADD CONSTRAINT "FaceSearchMatch_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "FaceSearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "EventGallery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppSession" ADD CONSTRAINT "WhatsAppSession_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WhatsAppTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessageLog" ADD CONSTRAINT "WhatsAppMessageLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WhatsAppCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppCampaign" ADD CONSTRAINT "WhatsAppCampaign_studioId_fkey" FOREIGN KEY ("studioId") REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE TABLE IF NOT EXISTS "ShortLink" (
  "id" TEXT PRIMARY KEY,
  "studioId" TEXT NOT NULL REFERENCES "Studio"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "token" TEXT NOT NULL,
  "targetHash" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_token_key" ON "ShortLink"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "ShortLink_studioId_targetHash_key" ON "ShortLink"("studioId", "targetHash");
