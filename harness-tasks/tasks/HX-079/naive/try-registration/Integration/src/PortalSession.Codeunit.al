codeunit 70425 "CGR Portal Session"
{
    var
        PortalTokenTok: Label 'CGR Portal Token', Locked = true;
        NoTokenErr: Label 'The partner portal did not issue a token.';

    procedure PortalSignIn()
    var
        Setup: Record "CGR Setup";
        NewToken: Text;
    begin
        OnIssuePortalToken(NewToken);
        if NewToken = '' then
            Error(NoTokenErr);
        IsolatedStorage.Set(PortalTokenTok, NewToken);
        Commit();
        if not TryRegister(NewToken) then
            Error(GetLastErrorText());
        Setup.GetOrCreate();
        Setup."Last Portal Sign-In" := CurrentDateTime();
        Setup.Modify();
    end;

    procedure PortalToken(): Text
    var
        Token: Text;
    begin
        if not IsolatedStorage.Get(PortalTokenTok, Token) then
            exit('');
        exit(Token);
    end;

    procedure ForgetPortalToken()
    begin
        if IsolatedStorage.Contains(PortalTokenTok) then
            IsolatedStorage.Delete(PortalTokenTok);
    end;

    [TryFunction]
    local procedure TryRegister(NewToken: Text)
    begin
        OnAfterPortalSignIn(NewToken);
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
