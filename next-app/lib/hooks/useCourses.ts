// useCourses — hook React que centraliza leitura/escrita da tabela `courses`
// via TanStack Query. Mesmo pattern do useQualifications: list + add + delete
// com invalidação automática.
//
// Substitui o trio vanilla (modules/quals-courses.js: loadCoursesList +
// addCourse + deleteCourse) por um state management declarativo. O port
// expõe a versão "simples" do add (só title + url) — o vanilla tem mais
// campos (subtitle, cover_url, duration, price/is_free) em um modal completo,
// mas o port aqui é alinhado com a UX de Formação (form curto).

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import {
  addCourse,
  deleteCourse,
  listCourses,
  type AddCourseInput,
  type Course,
} from '@/lib/services/formacao';

export interface UseCoursesResult {
  courses: Course[];
  loading: boolean;
  error: Error | null;
  add: (input: AddCourseInput) => void;
  remove: (courseId: string) => void;
  isAdding: boolean;
  isRemoving: boolean;
  addError: Error | null;
  removeError: Error | null;
}

export function useCourses(): UseCoursesResult {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<Course[], Error>({
    queryKey: ['courses', user?.id],
    queryFn: () => listCourses(user!.id),
    enabled: !!user,
    staleTime: 60_000,
  });

  const addMutation = useMutation<Course, Error, AddCourseInput>({
    mutationFn: (input: AddCourseInput) => addCourse(user!.id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses', user?.id] });
    },
  });

  const removeMutation = useMutation<void, Error, string>({
    mutationFn: (courseId: string) => deleteCourse(user!.id, courseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['courses', user?.id] });
    },
  });

  return {
    courses: query.data ?? [],
    loading: query.isLoading,
    error: query.error ?? null,
    add: addMutation.mutate,
    remove: removeMutation.mutate,
    isAdding: addMutation.isPending,
    isRemoving: removeMutation.isPending,
    addError: addMutation.error ?? null,
    removeError: removeMutation.error ?? null,
  };
}
