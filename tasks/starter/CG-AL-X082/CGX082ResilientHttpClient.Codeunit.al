codeunit 70471 "CG X082 Resilient Http Client"
{
    var
        TotalBackoffMs: Integer;

    procedure GetWithRetry(Url: Text; MaxAttempts: Integer; Handler: Interface "CG X082 Http Handler"; var ResponseBody: Text): Boolean
    var
        AttemptNo: Integer;
        StatusCode: Integer;
        Body: Text;
    begin
        ResponseBody := '';
        TotalBackoffMs := 0;

        for AttemptNo := 1 to MaxAttempts do begin
            if AttemptNo > 1 then
                TotalBackoffMs += BackoffDelayMs(AttemptNo - 1);

            Clear(StatusCode);
            Body := '';
            Handler.Send(Url, StatusCode, Body);

            if IsSuccess(StatusCode) then begin
                ResponseBody := Body;
                exit(true);
            end;

            if not IsTransient(StatusCode) then
                exit(false);
        end;

        exit(false);
    end;

    procedure BackoffDelayMs(RetryNumber: Integer): Integer
    var
        DelayMs: Integer;
        i: Integer;
    begin
        DelayMs := 100;
        for i := 2 to RetryNumber do
            DelayMs *= 2;
        exit(DelayMs);
    end;

    procedure GetTotalBackoffMs(): Integer
    begin
        exit(TotalBackoffMs);
    end;

    local procedure IsSuccess(StatusCode: Integer): Boolean
    begin
        exit((StatusCode >= 200) and (StatusCode <= 299));
    end;

    local procedure IsTransient(StatusCode: Integer): Boolean
    begin
        exit(StatusCode = 500);
    end;
}
