{{/* Expand the name of the chart. */}}
{{- define "cnpj-data-publisher.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Fully qualified app name. */}}
{{- define "cnpj-data-publisher.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "cnpj-data-publisher.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "cnpj-data-publisher.labels" -}}
helm.sh/chart: {{ include "cnpj-data-publisher.chart" . }}
{{ include "cnpj-data-publisher.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "cnpj-data-publisher.selectorLabels" -}}
app.kubernetes.io/name: {{ include "cnpj-data-publisher.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "cnpj-data-publisher.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "cnpj-data-publisher.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "cnpj-data-publisher.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "cnpj-data-publisher.pvcName" -}}
{{- if .Values.storage.local.existingClaim }}
{{- .Values.storage.local.existingClaim }}
{{- else }}
{{- printf "%s-data" (include "cnpj-data-publisher.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Environment shared by every workload. Secrets are always referenced, never
inlined, so they stay out of the rendered manifests (spec section 32).
*/}}
{{- define "cnpj-data-publisher.envVars" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      {{- if .Values.postgresql.enabled }}
      name: {{ printf "%s-postgresql-url" (include "cnpj-data-publisher.fullname" .) }}
      key: database-url
      {{- else }}
      name: {{ .Values.externalPostgresql.secretName }}
      key: {{ .Values.externalPostgresql.secretKey }}
      {{- end }}
- name: NATS_URL
  {{- if .Values.nats.enabled }}
  value: {{ printf "nats://%s-nats:4222" .Release.Name | quote }}
  {{- else }}
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalNats.secretName }}
      key: {{ .Values.externalNats.urlKey }}
  {{- end }}
{{- if and (not .Values.nats.enabled) .Values.externalNats.credentialsKey }}
- name: NATS_CREDS_FILE
  value: /etc/nats/credentials
{{- end }}
{{- if .Values.s3.secretName }}
- name: S3_ENDPOINT
  valueFrom:
    secretKeyRef:
      name: {{ .Values.s3.secretName }}
      key: {{ .Values.s3.endpointKey }}
- name: S3_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.s3.secretName }}
      key: {{ .Values.s3.accessKeyKey }}
- name: S3_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.s3.secretName }}
      key: {{ .Values.s3.secretKeyKey }}
{{- end }}
- name: STORAGE_LOCAL_PATH
  value: /data
{{- if and .Values.sink .Values.sink.databaseUrlSecret }}
- name: SINK_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.sink.databaseUrlSecret.name }}
      key: {{ .Values.sink.databaseUrlSecret.key | default "database-url" }}
{{- end }}
{{- if and .Values.notification.enabled .Values.notification.smtpPasswordSecret }}
- name: SMTP_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.notification.smtpPasswordSecret.name }}
      key: {{ .Values.notification.smtpPasswordSecret.key | default "smtp-password" }}
{{- end }}
{{- end }}

{{- define "cnpj-data-publisher.envFrom" -}}
- configMapRef:
    name: {{ include "cnpj-data-publisher.fullname" . }}
{{- end }}

{{/* Volumes: data PVC plus writable tmp for a read-only root filesystem. */}}
{{- define "cnpj-data-publisher.volumes" -}}
- name: data
  {{- if .Values.storage.local.enabled }}
  persistentVolumeClaim:
    claimName: {{ include "cnpj-data-publisher.pvcName" . }}
  {{- else }}
  emptyDir: {}
  {{- end }}
- name: tmp
  emptyDir: {}
{{- if and (not .Values.nats.enabled) .Values.externalNats.credentialsKey }}
- name: nats-creds
  secret:
    secretName: {{ .Values.externalNats.secretName }}
    items:
      - key: {{ .Values.externalNats.credentialsKey }}
        path: credentials
{{- end }}
{{- end }}

{{- define "cnpj-data-publisher.volumeMounts" -}}
- name: data
  mountPath: /data
- name: tmp
  mountPath: /tmp
{{- if and (not .Values.nats.enabled) .Values.externalNats.credentialsKey }}
- name: nats-creds
  mountPath: /etc/nats
  readOnly: true
{{- end }}
{{- end }}
