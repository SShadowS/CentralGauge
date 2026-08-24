codeunit 89297 "CG-AL-X103 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure SeedSubmission(No: Code[20]; ContactEmail: Text[80]; NotifyEmail: Text[80]; SetupCode: Code[10]): Record "CG X103 Submission"
    var
        Submission: Record "CG X103 Submission";
    begin
        Submission.Init();
        Submission."No." := No;
        Submission."Contact E-Mail" := ContactEmail;
        Submission."Notify E-Mail" := NotifyEmail;
        Submission."Setup Code" := SetupCode;
        Submission.Insert();
        exit(Submission);
    end;

    local procedure SeedSetup(SetupCode: Code[10]; FallbackEmail: Text[80])
    var
        NotifySetup: Record "CG X103 Notify Setup";
    begin
        NotifySetup.Init();
        NotifySetup.Code := SetupCode;
        NotifySetup."Fallback E-Mail" := FallbackEmail;
        NotifySetup.Insert();
    end;

    local procedure ClearAllData()
    var
        Submission: Record "CG X103 Submission";
        NotifySetup: Record "CG X103 Notify Setup";
    begin
        Submission.DeleteAll();
        NotifySetup.DeleteAll();
    end;

    [Test]
    procedure BlankContactEmailStillSubmitsWhenNotifyEmailIsSet()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        Submission := SeedSubmission('SUB001', '', 'notify1@example.com', '');

        Submitter.Guard(Submission);

        Assert.AreEqual('notify1@example.com', Submitter.BuildPayload(Submission),
            'Expected a submission with a usable notification e-mail to build that e-mail as its payload');
    end;

    [Test]
    procedure NonBlankContactEmailWithNoUsableEmailIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        Submission := SeedSubmission('SUB002', 'someone@example.com', '', 'NOSETUP');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure BlankContactEmailAndNoUsableEmailIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        Submission := SeedSubmission('SUB003', '', '', '');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure FullChainPrefersNotifyEmailOverFallback()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        SeedSetup('SETUPX', 'fallbackx@example.com');
        Submission := SeedSubmission('SUB004', 'contact4@example.com', 'notify4@example.com', 'SETUPX');

        Submitter.Guard(Submission);

        Assert.AreEqual('notify4@example.com', Submitter.BuildPayload(Submission),
            'Expected the submission''s own notification e-mail to win over the setup fallback when both are present');
    end;

    [Test]
    procedure FullChainFallsBackToSetupWhenNotifyEmailIsBlank()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        SeedSetup('SETUPY', 'fallbacky@example.com');
        Submission := SeedSubmission('SUB005', 'contact5@example.com', '', 'SETUPY');

        Submitter.Guard(Submission);

        Assert.AreEqual('fallbacky@example.com', Submitter.BuildPayload(Submission),
            'Expected the setup fallback e-mail to be used when the submission has no notification e-mail of its own');
    end;

    [Test]
    procedure LinkedSetupWithBlankFallbackIsRejected()
    var
        Submitter: Codeunit "CG X103 Submitter";
        Submission: Record "CG X103 Submission";
    begin
        ClearAllData();

        SeedSetup('SETUPZ', '');
        Submission := SeedSubmission('SUB007', 'contact7@example.com', '', 'SETUPZ');

        Assert.AreEqual('', Submitter.BuildPayload(Submission),
            'Expected a submission whose linked setup has no fallback e-mail to derive no usable payload');

        asserterror Submitter.Guard(Submission);

        Assert.ExpectedError('Cannot determine a notification e-mail');
    end;

    [Test]
    procedure DifferentSubmissionsResolveTheirOwnSetupRecord()
    var
        Submitter: Codeunit "CG X103 Submitter";
        SubmissionA: Record "CG X103 Submission";
        SubmissionB: Record "CG X103 Submission";
    begin
        ClearAllData();

        SeedSetup('SETUPA', 'a@example.com');
        SeedSetup('SETUPB', 'b@example.com');
        SubmissionA := SeedSubmission('SUB006A', 'contactA@example.com', '', 'SETUPA');
        SubmissionB := SeedSubmission('SUB006B', 'contactB@example.com', '', 'SETUPB');

        Assert.AreEqual('a@example.com', Submitter.BuildPayload(SubmissionA),
            'Expected the first submission to resolve the fallback e-mail from its own linked setup, not another submission''s');
        Assert.AreEqual('b@example.com', Submitter.BuildPayload(SubmissionB),
            'Expected the second submission to resolve the fallback e-mail from its own linked setup, not another submission''s');
    end;
}
