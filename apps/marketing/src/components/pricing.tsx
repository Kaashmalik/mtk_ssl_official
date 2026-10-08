"use client";

import { motion } from "framer-motion";
import { Button } from "@mtk/ui";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@mtk/ui";
import { Check, Star } from "lucide-react";

/**
 * 4-Tier pricing — must match the DB enum `tenant_plan`:
 *   free | starter | pro | enterprise
 *
 * Prices (PKR, per league):
 *   Free     — Rs 0
 *   Starter  — Rs 4,999
 *   Pro      — Rs 14,999
 *   Enterprise — Rs 49,999
 */
const plans = [
  {
    name: "Free",
    price: "0",
    period: "forever",
    description: "Perfect for small local leagues",
    features: [
      "Up to 4 teams",
      "Basic scoring",
      "Points table",
      "Public league page",
      "Community support",
    ],
    cta: "Get Started",
    ctaHref: "/sign-up",
    popular: false,
  },
  {
    name: "Starter",
    price: "4,999",
    period: "per league",
    description: "For growing leagues",
    features: [
      "Up to 16 teams",
      "Advanced scoring",
      "Player statistics",
      "Custom branding",
      "Email support",
      "Payment collection",
    ],
    cta: "Start Free Trial",
    ctaHref: "/sign-up",
    popular: false,
  },
  {
    name: "Pro",
    price: "14,999",
    period: "per league",
    description: "For professional leagues",
    features: [
      "Unlimited teams & players",
      "Live streaming integration",
      "Fantasy cricket (roadmap)",
      "White-label option",
      "Priority support",
      "Advanced analytics",
      "API access",
    ],
    cta: "Get Started",
    ctaHref: "/sign-up",
    popular: true,
  },
  {
    name: "Enterprise",
    price: "49,999",
    period: "per league",
    description: "For major tournaments & boards",
    features: [
      "Everything in Pro",
      "White-label + custom domain",
      "Dedicated support",
      "SLA guarantee",
      "Custom integrations",
      "Training & onboarding",
    ],
    cta: "Contact Sales",
    ctaHref: "mailto:sales@ssl.cricket?subject=Enterprise Inquiry",
    popular: false,
  },
];

export function Pricing() {
  return (
    <section className="py-24 bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950 scroll-mt-20">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <motion.h2
            className="text-4xl md:text-5xl font-bold text-gray-900 dark:text-white mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            Simple, Transparent Pricing
          </motion.h2>
          <motion.p
            className="text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Choose the perfect plan for your league. Start free, upgrade anytime.
          </motion.p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="relative"
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 z-10">
                  <span className="bg-gradient-to-r from-emerald-500 to-green-600 text-white px-4 py-1 rounded-full text-sm font-semibold flex items-center gap-1">
                    <Star className="w-4 h-4 fill-current" />
                    Most Popular
                  </span>
                </div>
              )}
              <Card
                className={`h-full flex flex-col ${
                  plan.popular
                    ? "border-2 border-emerald-500 shadow-xl scale-105"
                    : "border"
                }`}
              >
                <CardHeader>
                  <CardTitle className="text-2xl mb-2">{plan.name}</CardTitle>
                  <CardDescription className="text-sm mb-4">
                    {plan.description}
                  </CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-gray-900 dark:text-white">
                      Rs {plan.price}
                      {plan.period !== "forever" && (
                        <span className="text-lg font-normal text-gray-600 dark:text-gray-400">
                          /{plan.period}
                        </span>
                      )}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                        <span className="text-gray-700 dark:text-gray-300">
                          {feature}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  <Button
                    className="w-full"
                    size="lg"
                    variant={plan.popular ? "default" : "outline"}
                    onClick={() => {
                      window.location.href = plan.ctaHref;
                    }}
                  >
                    {plan.cta}
                  </Button>
                </CardFooter>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
