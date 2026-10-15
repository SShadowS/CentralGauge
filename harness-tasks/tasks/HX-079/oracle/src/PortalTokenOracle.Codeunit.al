codeunit 87040 "HX079 Portal Token Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SignInKeepsToken()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Before: DateTime;
        After: DateTime;
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.AreEqual('', HX79Token(), 'No token is stored before the sign-in');

        Before := CurrentDateTime();
        Ok := HX79SignIn(Runner, Partner, 'HX079-R1-T1', false, false);
        After := CurrentDateTime();

        Assert.IsTrue(Ok, 'The sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R1-T1', HX79Token(), 'PortalToken returns the issued token');
        Assert.AreEqual(1, Partner.HX79Calls(), 'OnAfterPortalSignIn is raised once');
        HX79AssertStampInWindow(Before, After);
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure NewTokenReplaces()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R2-T1', false, false), 'The first sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R2-T1', HX79Token(), 'The first token is stored');

        Ok := HX79SignIn(Runner, Partner, 'HX079-R2-T2', false, false);

        Assert.IsTrue(Ok, 'The second sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R2-T2', HX79Token(), 'The new token replaces the stored token');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure FailedRegistrationKeepsNewToken()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        ErrorText: Text;
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R3-T1', false, false), 'The first sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R3-T1', HX79Token(), 'The first token is stored');
        Assert.AreNotEqual(0DT, HX79Stamp(), 'The first sign-in sets Last Portal Sign-In');
        HX79ResetStamp();
        Partner.HX79ResetCalls();

        Ok := HX79SignIn(Runner, Partner, 'HX079-R3-T2', true, true);
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'The sign-in fails when a partner refuses the registration');
        Assert.AreEqual('HX079 registration refused.', ErrorText, 'The sign-in fails with the partner''s error');
        Assert.AreEqual(1, Partner.HX79Calls(), 'The partner was asked to register');
        Assert.AreEqual('HX079-R3-T2', HX79Token(), 'The new token stays stored after the failed registration');
        Assert.AreEqual(0, HX79MarkerCount(), 'Nothing the partner wrote during the registration is kept');
        Assert.AreEqual(0DT, HX79Stamp(), 'Last Portal Sign-In is not changed by the failed sign-in');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure PartnersSeeNewToken()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R4-T1', false, false), 'The first sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R4-T1', HX79Token(), 'The first token is stored');
        Partner.HX79ResetCalls();

        Ok := HX79SignIn(Runner, Partner, 'HX079-R4-T2', false, false);

        Assert.IsTrue(Ok, 'The second sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual(1, Partner.HX79Calls(), 'OnAfterPortalSignIn is raised once');
        Assert.AreEqual('HX079-R4-T2', Partner.HX79SeenToken(), 'OnAfterPortalSignIn carries the new token');
        Assert.AreEqual('HX079-R4-T2', Partner.HX79StoredAtEvent(), 'PortalToken already returns the new token when OnAfterPortalSignIn is raised');
        Assert.AreEqual('HX079-R4-T2', HX79Token(), 'The new token is stored');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure BlankTokenRefused()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        ErrorText: Text;
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R5-T1', false, false), 'The first sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R5-T1', HX79Token(), 'The first token is stored');
        HX79ResetStamp();
        Partner.HX79ResetCalls();

        Ok := HX79SignIn(Runner, Partner, '', false, false);
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'A sign-in without a token fails');
        Assert.AreEqual('The partner portal did not issue a token.', ErrorText, 'The sign-in fails with the no-token error');
        Assert.AreEqual('HX079-R5-T1', HX79Token(), 'The previous token stays stored');
        Assert.AreEqual(0, Partner.HX79Calls(), 'OnAfterPortalSignIn is not raised');
        Assert.AreEqual(0DT, HX79Stamp(), 'Last Portal Sign-In is not changed');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure RegistrationWritesKeptOnSuccess()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.AreEqual(0, HX79MarkerCount(), 'No marker entry before the sign-in');

        Ok := HX79SignIn(Runner, Partner, 'HX079-R6-T3', true, false);

        Assert.IsTrue(Ok, 'The sign-in succeeds when the partner writes during the registration: ' + GetLastErrorText());
        Assert.AreEqual(1, HX79MarkerCount(), 'What the partner wrote during a successful registration is kept');
        Assert.AreEqual('HX079-R6-T3', HX79Token(), 'The new token is stored');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure ForgetDropsToken()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Ok1: Boolean;
        Ok2: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R7-T1', false, false), 'The sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R7-T1', HX79Token(), 'The token is stored');

        Runner.HX79SetForget();
        Commit();
        Ok1 := Runner.Run();
        Commit();
        Ok2 := Runner.Run();

        Assert.IsTrue(Ok1, 'ForgetPortalToken succeeds: ' + GetLastErrorText());
        Assert.IsTrue(Ok2, 'ForgetPortalToken succeeds when no token is stored: ' + GetLastErrorText());
        Assert.AreEqual('', HX79Token(), 'No token is stored after the forget');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure ForgetUndoneWithItsTransaction()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        ErrorText: Text;
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Assert.IsTrue(HX79SignIn(Runner, Partner, 'HX079-R8-T1', false, false), 'The sign-in succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R8-T1', HX79Token(), 'The token is stored');

        Runner.HX79SetForgetThenFail();
        Commit();
        Ok := Runner.Run();
        ErrorText := GetLastErrorText();

        Assert.IsFalse(Ok, 'The transaction with the forget fails');
        Assert.AreEqual('HX079 later step failed.', ErrorText, 'It fails with the later step''s error');
        Assert.AreEqual('HX079-R8-T1', HX79Token(), 'The forget is undone with its failed transaction');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure NoTokenBeforeFirstSignIn()
    var
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);

        Assert.AreEqual('', HX79Token(), 'PortalToken returns '''' when no token is stored');
        Ok := HX79SignIn(Runner, Partner, 'HX079-R9-T1', false, false);
        Assert.IsTrue(Ok, 'A sign-in after a forget succeeds: ' + GetLastErrorText());
        Assert.AreEqual('HX079-R9-T1', HX79Token(), 'The token issued after the forget is stored');
        HX79Cleanup(Runner);
    end;

    [Test]
    procedure SignInFieldAsSpecified()
    var
        AllObj: Record AllObj;
        RecRef: RecordRef;
        FldRef: FieldRef;
    begin
        RecRef.Open(Database::"CGR Setup");
        Assert.IsTrue(RecRef.FieldExist(70425), 'CGR Setup has field 70425');
        FldRef := RecRef.Field(70425);
        Assert.AreEqual('Last Portal Sign-In', FldRef.Name(), 'Field 70425 is Last Portal Sign-In');
        Assert.IsTrue(FldRef.Type() = FieldType::DateTime, 'Field 70425 is a DateTime');
        RecRef.Close();

        AllObj.SetRange("Object Type", AllObj."Object Type"::Codeunit);
        AllObj.SetRange("Object ID", 70425);
        Assert.IsTrue(AllObj.FindFirst(), 'Codeunit 70425 exists');
        Assert.AreEqual('CGR Portal Session', AllObj."Object Name", 'Codeunit 70425 is CGR Portal Session');
    end;

    [Test]
    procedure SignInWithoutSetupRow()
    var
        Setup: Record "CGR Setup";
        Partner: Codeunit "HX079 Portal Partner";
        Runner: Codeunit "HX079 Portal Runner";
        Before: DateTime;
        After: DateTime;
        Stamp: DateTime;
        Token: Text;
        SetupExists: Boolean;
        Ok: Boolean;
    begin
        HX79Init(Runner);
        BindSubscription(Partner);
        Setup.DeleteAll();
        Commit();

        Before := CurrentDateTime();
        Ok := HX79SignIn(Runner, Partner, 'HX079-R11-T1', false, false);
        After := CurrentDateTime();
        Token := HX79Token();
        SetupExists := Setup.Get();
        Stamp := Setup."Last Portal Sign-In";
        HX79SetSetup();
        Commit();

        Assert.IsTrue(Ok, 'The sign-in succeeds without a CGR Setup record');
        Assert.AreEqual('HX079-R11-T1', Token, 'The token is stored');
        Assert.IsTrue(SetupExists, 'The sign-in creates the CGR Setup record');
        Assert.IsTrue(Stamp >= Before - 60000, 'Last Portal Sign-In is not before the sign-in');
        Assert.IsTrue(Stamp <= After + 60000, 'Last Portal Sign-In is not after the sign-in');
        HX79Cleanup(Runner);
    end;

    local procedure HX79Init(var Runner: Codeunit "HX079 Portal Runner")
    var
        Entry: Record "CGR Outbox Entry";
    begin
        WorkDate(20270301D);
        HX79SetSetup();
        Entry.SetRange("Vehicle No.", 'HX079-MARK');
        Entry.DeleteAll();
        HX79Cleanup(Runner);
    end;

    local procedure HX79SetSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup."Last Portal Sign-In" := 0DT;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure HX79Cleanup(var Runner: Codeunit "HX079 Portal Runner")
    begin
        Runner.HX79SetForget();
        Commit();
        if Runner.Run() then;
        Commit();
    end;

    local procedure HX79SignIn(var Runner: Codeunit "HX079 Portal Runner"; var Partner: Codeunit "HX079 Portal Partner"; IssuedToken: Text; QueueMarker: Boolean; Refuse: Boolean): Boolean
    begin
        Partner.HX79Configure(IssuedToken, QueueMarker, Refuse);
        Runner.HX79SetSignIn();
        Commit();
        exit(Runner.Run());
    end;

    local procedure HX79Token(): Text
    var
        PortalSession: Codeunit "CGR Portal Session";
    begin
        exit(PortalSession.PortalToken());
    end;

    local procedure HX79Stamp(): DateTime
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        exit(Setup."Last Portal Sign-In");
    end;

    local procedure HX79ResetStamp()
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        Setup."Last Portal Sign-In" := 0DT;
        Setup.Modify();
        Commit();
    end;

    local procedure HX79MarkerCount(): Integer
    var
        Entry: Record "CGR Outbox Entry";
    begin
        Entry.SetRange("Vehicle No.", 'HX079-MARK');
        exit(Entry.Count());
    end;

    local procedure HX79AssertStampInWindow(Before: DateTime; After: DateTime)
    var
        Stamp: DateTime;
    begin
        Stamp := HX79Stamp();
        Assert.AreNotEqual(0DT, Stamp, 'Last Portal Sign-In is set');
        Assert.IsTrue(Stamp >= Before - 60000, 'Last Portal Sign-In is not before the sign-in');
        Assert.IsTrue(Stamp <= After + 60000, 'Last Portal Sign-In is not after the sign-in');
    end;
}
