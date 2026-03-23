param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$LessonId = "preflight-smoke",
  [int]$ExpectedHttpStatus = 0,
  [string]$ExpectedApiStatus = ""
)

$uri = "$($BaseUrl.TrimEnd('/'))/api/video/render"

$payload = @{
  lessonId = $LessonId
  events = @(
    @{
      id = "evt-1"
      timestampMs = 0
      type = "slide_change"
      slideId = "intro"
      title = "Intro"
    }
  )
} | ConvertTo-Json -Depth 8

function Get-ErrorBody([System.Exception]$Exception) {
  if (-not $Exception.Response) {
    return ""
  }

  try {
    $stream = $Exception.Response.GetResponseStream()
    if (-not $stream) {
      return ""
    }

    $reader = New-Object System.IO.StreamReader($stream)
    return $reader.ReadToEnd()
  } catch {
    return ""
  }
}

$statusCode = 0
$rawBody = ""

try {
  $response = Invoke-WebRequest -Uri $uri -Method POST -ContentType "application/json" -Body $payload
  $statusCode = [int]$response.StatusCode
  $rawBody = [string]$response.Content
} catch {
  if ($_.Exception.Response) {
    $statusCode = [int]$_.Exception.Response.StatusCode
    $rawBody = Get-ErrorBody -Exception $_.Exception
  } else {
    Write-Error "Request failed without HTTP response: $($_.Exception.Message)"
    exit 1
  }
}

Write-Host "HTTP Status: $statusCode"

if ([string]::IsNullOrWhiteSpace($rawBody)) {
  Write-Host "Response Body: <empty>"
  if ($ExpectedApiStatus) {
    Write-Error "Expected API status '$ExpectedApiStatus' but response body is empty"
    exit 1
  }
} else {
  Write-Host "Response Body:"
  Write-Host $rawBody
}

if ($ExpectedHttpStatus -gt 0 -and $statusCode -ne $ExpectedHttpStatus) {
  Write-Error "Expected HTTP status $ExpectedHttpStatus but got $statusCode"
  exit 1
}

if ($ExpectedApiStatus) {
  try {
    $bodyJson = $rawBody | ConvertFrom-Json
  } catch {
    Write-Error "Expected API status '$ExpectedApiStatus' but response body is not valid JSON"
    exit 1
  }

  if (-not $bodyJson.status) {
    Write-Error "Expected API status '$ExpectedApiStatus' but 'status' field is missing"
    exit 1
  }

  if ($bodyJson.status -ne $ExpectedApiStatus) {
    Write-Error "Expected API status '$ExpectedApiStatus' but got '$($bodyJson.status)'"
    exit 1
  }
}

Write-Host "Preflight smoke test passed."