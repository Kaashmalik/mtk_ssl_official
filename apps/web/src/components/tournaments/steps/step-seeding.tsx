"use client"

import React, { useCallback, useEffect, useState } from "react"
import { UseFormReturn } from "react-hook-form"
import { Card, CardContent } from "@mtk/ui"
import { GripVertical } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { TournamentFormData } from "../tournament-wizard"
import { useLanguage } from "@/hooks/use-language"
import { reconcileSlotOrder } from "@/lib/tournament-wizard"

export interface StepSeedingProps {
  form: UseFormReturn<TournamentFormData>
}

function SortableTeamItem({
  id,
  name,
}: {
  id: string
  name: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-4 bg-card border rounded-lg cursor-grab active:cursor-grabbing"
    >
      <div {...attributes} {...listeners} className="cursor-grab">
        <GripVertical className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1">
        <p className="font-medium">{name}</p>
      </div>
      <div className="text-sm text-muted-foreground">Drag to seed</div>
    </div>
  )
}

export function StepSeeding({ form }: StepSeedingProps) {
  const { t } = useLanguage()
  const maxTeams = form.watch("maxTeams")
  const format = form.watch("format")
  const seedKey = (form.watch("teamSeeding") ?? []).join(",")
  // Stable bracket slots; registered teams are assigned later.
  const generateTeams = useCallback(() => {
    return reconcileSlotOrder(seedKey ? seedKey.split(",") : [], maxTeams)
      .map((id) => ({ id, name: `Slot ${id.slice(5)}` }))
  }, [seedKey, maxTeams])

  const [teams, setTeams] = useState(() => generateTeams())

  useEffect(() => {
    const next = generateTeams()
    setTeams(next)
    const order = next.map((team) => team.id)
    if (order.join(",") !== seedKey) form.setValue("teamSeeding", order, { shouldValidate: true })
  }, [generateTeams, form, seedKey])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = teams.findIndex((item) => item.id === active.id)
      const newIndex = teams.findIndex((item) => item.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const newItems = arrayMove(teams, oldIndex, newIndex)
      setTeams(newItems)
      form.setValue("teamSeeding", newItems.map((item) => item.id), { shouldValidate: true, shouldDirty: true })
    }
  }

  // Only show seeding for knockout and hybrid formats
  if (format === "league") {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          {t("seedingNotRequired") ||
            "Team seeding is not required for league format"}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t("teamSeeding")}
        </h2>
        <p className="text-gray-600 dark:text-gray-300">
          {t("dragToReorder")}
        </p>
        <p className="text-sm text-muted-foreground mt-2">This sets bracket slot order. Registered teams are assigned to slots when fixtures are created.</p>
      </div>

      <Card>
        <CardContent className="p-6">
          {form.formState.errors.teamSeeding && <p role="alert" className="text-sm text-destructive mb-3">{form.formState.errors.teamSeeding.message}</p>}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={teams.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {teams.map((team) => (
                  <SortableTeamItem key={team.id} id={team.id} name={team.name} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </CardContent>
      </Card>
    </div>
  )
}

