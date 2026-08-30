// Stand-in for a handler that catches an internal error and returns without
// ever assigning StatusCode: the first call reports a transient 500 so the
// caller retries, and every call after that leaves StatusCode exactly as it
// found it - proving a swallowed-error attempt is never mistaken for a
// repeat of whatever status the attempt before it happened to report.
codeunit 89399 "CG-AL-X175 NoStatus Handler" implements "CG X082 Http Handler"
{
    var
        RequestCount: Integer;

    procedure Send(Url: Text; var StatusCode: Integer; var Body: Text)
    begin
        RequestCount += 1;
        if RequestCount = 1 then
            StatusCode := 500;
        Body := 'no status reported';
    end;

    procedure GetRequestCount(): Integer
    begin
        exit(RequestCount);
    end;
}
