codeunit 70425 "CGR Portal Session"
{
    SingleInstance = true;

    var
        StoredToken: Text;
        NoTokenErr: Label 'The partner portal did not issue a token.';

    procedure PortalSignIn()
    var
        Setup: Record "CGR Setup";
        NewToken: Text;
    begin
        OnIssuePortalToken(NewToken);
        if NewToken = '' then
            Error(NoTokenErr);
        StoredToken := NewToken;
        OnAfterPortalSignIn(NewToken);
        Setup.GetOrCreate();
        Setup."Last Portal Sign-In" := CurrentDateTime();
        Setup.Modify();
    end;

    procedure PortalToken(): Text
    begin
        exit(StoredToken);
    end;

    procedure ForgetPortalToken()
    begin
        StoredToken := '';
    end;

    [IntegrationEvent(false, false)]
    local procedure OnIssuePortalToken(var NewToken: Text)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPortalSignIn(NewToken: Text)
    begin
    end;
}
