import Link from "next/link"
import { Trophy, ArrowLeft } from "lucide-react"
import { Button } from "@mtk/ui/components/ui/button"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"

/**
 * Root 404 page — renders for any unmatched route.
 * Previously the bare Next.js default 404 was shown.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <MotionWrapper variant="fadeInUp" className="max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
        </div>

        <p className="text-6xl font-bold tracking-tight text-foreground">404</p>
        <h1 className="text-2xl font-semibold mt-4 text-foreground">Page not found</h1>
        <p className="text-muted-foreground mt-2">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have been moved.
        </p>

        <div className="flex items-center justify-center gap-3 mt-8">
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Home
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="gradient-shine">
              <Trophy className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </MotionWrapper>
    </div>
  )
}
