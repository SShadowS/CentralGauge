// Stand-in for the flaky rates provider: answers each request sent through
// the handler seam with the next scripted status/body and records every
// URL it sees. Requests beyond the script replay the last scripted answer,
// so a runaway retry loop terminates on a stable status instead of erroring
// inside the mock.
codeunit 89398 "CG-AL-X175 Mock Http Handler" implements "CG X082 Http Handler"
{
    var
        ScriptedStatuses: List of [Integer];
        ScriptedBodies: List of [Text];
        LastStatus: Integer;
        LastBody: Text;
        CapturedUrls: List of [Text];

    procedure Send(Url: Text; var StatusCode: Integer; var Body: Text)
    begin
        CapturedUrls.Add(Url);

        if ScriptedStatuses.Count() > 0 then begin
            LastStatus := ScriptedStatuses.Get(1);
            ScriptedStatuses.RemoveAt(1);
            if ScriptedBodies.Count() > 0 then begin
                LastBody := ScriptedBodies.Get(1);
                ScriptedBodies.RemoveAt(1);
            end else
                LastBody := '';
        end;

        StatusCode := LastStatus;
        Body := LastBody;
    end;

    procedure ScriptResponse(StatusCode: Integer; Body: Text)
    begin
        ScriptedStatuses.Add(StatusCode);
        ScriptedBodies.Add(Body);
    end;

    procedure ScriptStatus(StatusCode: Integer)
    begin
        ScriptResponse(StatusCode, '');
    end;

    procedure GetRequestCount(): Integer
    begin
        exit(CapturedUrls.Count());
    end;

    procedure GetCapturedUrl(Index: Integer): Text
    begin
        exit(CapturedUrls.Get(Index));
    end;
}
