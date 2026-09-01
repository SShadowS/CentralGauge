codeunit 70632 "CG X103 Submitter"
{
    procedure Guard(Submission: Record "CG X103 Submission")
    begin
        if ResolveNotifyEmail(Submission) = '' then
            Error('Cannot determine a notification e-mail for submission %1.', Submission."No.");
    end;

    procedure BuildPayload(Submission: Record "CG X103 Submission"): Text
    begin
        exit(ResolveNotifyEmail(Submission));
    end;

    local procedure ResolveNotifyEmail(Submission: Record "CG X103 Submission"): Text
    var
        NotifySetup: Record "CG X103 Notify Setup";
    begin
        if Submission."Notify E-Mail" <> '' then
            exit(Submission."Notify E-Mail");
        if NotifySetup.Get(Submission."Setup Code") then
            if NotifySetup."Fallback E-Mail" <> '' then
                exit(NotifySetup."Fallback E-Mail");
        exit('');
    end;
}
