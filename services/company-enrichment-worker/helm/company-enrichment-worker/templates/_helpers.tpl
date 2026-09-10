{{/*
Expand the name of the chart.
*/}}
{{- define "company-enrichment-worker.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "company-enrichment-worker.fullname" -}}
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

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "company-enrichment-worker.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "company-enrichment-worker.labels" -}}
helm.sh/chart: {{ include "company-enrichment-worker.chart" . }}
app.kubernetes.io/name: {{ include "company-enrichment-worker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "company-enrichment-worker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "company-enrichment-worker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Infisical managed K8s secret name consumed as envFrom.
*/}}
{{- define "company-enrichment-worker.secretName" -}}
{{- if .Values.infisical.enabled }}
{{- .Values.infisical.managedSecretName }}
{{- else }}
""
{{- end }}
{{- end }}
