import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { OtpVerification } from "@/components/auth/otp-verification"

export default function VerifyOtpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Verify your contact</CardTitle>
        </CardHeader>
        <CardContent>
          <OtpVerification />
        </CardContent>
      </Card>
    </div>
  )
}
