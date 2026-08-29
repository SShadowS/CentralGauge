codeunit 89379 "CG-AL-X159 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the home company's tables before seeding its own
    // rows. Cross-company tests also clear the other company, durably
    // (Commit()'d), both before seeding and again after asserting, so a
    // failed assertion never leaves the other company dirty for the next
    // test.

    local procedure GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure ClearHome()
    var
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
    begin
        Contact.DeleteAll();
        Registry.DeleteAll();
    end;

    local procedure ClearOther(OtherName: Text[30])
    var
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
    begin
        Contact.ChangeCompany(OtherName);
        Contact.DeleteAll();
        Registry.ChangeCompany(OtherName);
        Registry.DeleteAll();
    end;

    local procedure ClearBoth(OtherName: Text[30])
    begin
        ClearHome();
        ClearOther(OtherName);
        Commit();
    end;

    local procedure CreateContact(No: Code[20]; EmailAddr: Text[80])
    var
        Contact: Record "CG X159 Contact";
    begin
        Contact.Init();
        Contact."No." := No;
        Contact.Email := EmailAddr;
        Contact.Insert(true);
    end;

    local procedure RegisterEmail(EmailAddr: Text[80]; ContactNo: Code[20])
    var
        Registry: Record "CG X159 Email Registry";
    begin
        Registry.Init();
        Registry.Email := EmailAddr;
        Registry."Contact No." := ContactNo;
        Registry.Insert(true);
    end;

    local procedure RegisterEmailInCompany(OtherName: Text[30]; EmailAddr: Text[80]; ContactNo: Code[20])
    var
        Registry: Record "CG X159 Email Registry";
    begin
        Registry.ChangeCompany(OtherName);
        Registry.Init();
        Registry.Email := EmailAddr;
        Registry."Contact No." := ContactNo;
        Registry.Insert(true);
    end;

    local procedure SeqCode(Prefix: Text; Seq: Integer): Code[20]
    var
        Digits: Text;
    begin
        Digits := Format(Seq);
        while StrLen(Digits) < 4 do
            Digits := '0' + Digits;
        exit(CopyStr(Prefix + '-' + Digits, 1, 20));
    end;

    local procedure SeqEmail(Prefix: Text; Seq: Integer): Text[80]
    var
        Digits: Text;
    begin
        Digits := Format(Seq);
        while StrLen(Digits) < 4 do
            Digits := '0' + Digits;
        exit(CopyStr(Prefix + Digits + '@example.com', 1, 80));
    end;

    [Test]
    procedure AUniqueEmailIsAcceptedAndPersisted()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
        Result: Boolean;
    begin
        ClearHome();
        CreateContact('C-0001', 'old.address@example.com');
        RegisterEmail('old.address@example.com', 'C-0001');

        Contact.Get('C-0001');
        Result := ContactMgt.SaveContact(Contact, 'new.address@example.com');

        Contact.Get('C-0001');

        Assert.IsTrue(Result, 'Expected saving a genuinely unique email to be accepted');
        Assert.AreEqual('new.address@example.com', Contact.Email,
            'Expected the contact''s email to be updated to the new address');
        Assert.IsTrue(Registry.Get('new.address@example.com'), 'Expected the new email to be registered');
        Assert.AreEqual('C-0001', Registry."Contact No.",
            'Expected the new registration to point back at the contact that claimed it');
    end;

    [Test]
    procedure ChangingEmailRetiresTheOldRegistrationAndTheNewOneIsImmediatelyEnforced()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        ContactA: Record "CG X159 Contact";
        ContactB: Record "CG X159 Contact";
        ContactC: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
        ResultB: Boolean;
        ResultC: Boolean;
    begin
        ClearHome();
        CreateContact('C-0010', 'a.retiring@example.com');
        RegisterEmail('a.retiring@example.com', 'C-0010');
        CreateContact('C-0011', 'placeholder-b@example.com');
        CreateContact('C-0012', 'placeholder-c@example.com');

        ContactA.Get('C-0010');
        ContactMgt.SaveContact(ContactA, 'a.claimed@example.com');

        // The vacated email must become available immediately...
        ContactB.Get('C-0011');
        ResultB := ContactMgt.SaveContact(ContactB, 'a.retiring@example.com');

        // ...and the just-claimed email must already be enforced against a
        // second contact trying to grab it in the same session.
        ContactC.Get('C-0012');
        ResultC := ContactMgt.SaveContact(ContactC, 'a.claimed@example.com');

        Assert.IsTrue(ResultB,
            'Expected the address the first contact gave up to become available for another contact to claim');
        Assert.IsFalse(ResultC,
            'Expected the address the first contact just claimed to already be enforced against a second contact in the same session');

        Assert.IsTrue(Registry.Get('a.retiring@example.com'),
            'Expected the vacated email to be registered again, now to the contact that claimed it');
        Assert.AreEqual('C-0011', Registry."Contact No.",
            'Expected the vacated email''s registration to now point at the contact that claimed it');

        Assert.IsTrue(Registry.Get('a.claimed@example.com'), 'Expected the newly claimed email to remain registered');
        Assert.AreEqual('C-0010', Registry."Contact No.",
            'Expected the newly claimed email to still be registered to the contact that claimed it first, unaffected by a later contact trying to grab it');

        ContactC.Get('C-0012');
        Assert.AreEqual('placeholder-c@example.com', ContactC.Email,
            'Expected the refused contact''s email to remain exactly as it was');
    end;

    [Test]
    procedure AnEmailAlreadyRegisteredInTheOtherCompanyIsRefused()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        Contact: Record "CG X159 Contact";
        OtherRegistry: Record "CG X159 Email Registry";
        OtherName: Text[30];
        Result: Boolean;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        CreateContact('C-0020', 'home.contact@example.com');
        RegisterEmail('home.contact@example.com', 'C-0020');
        RegisterEmailInCompany(OtherName, 'taken.elsewhere@example.com', 'OTH-001');

        Contact.Get('C-0020');
        Result := ContactMgt.SaveContact(Contact, 'taken.elsewhere@example.com');

        Contact.Get('C-0020');
        OtherRegistry.ChangeCompany(OtherName);

        Assert.IsFalse(Result,
            'Expected an email already registered to a different contact in another company to be refused');
        Assert.AreEqual('home.contact@example.com', Contact.Email,
            'Expected the contact''s email to remain unchanged after a cross-company duplicate was refused');
        Assert.IsTrue(OtherRegistry.Get('taken.elsewhere@example.com'),
            'Expected the other company''s registration to remain exactly as it was');
        Assert.AreEqual('OTH-001', OtherRegistry."Contact No.",
            'Expected the other company''s registration to still point at its own contact');

        ClearBoth(OtherName);
    end;

    [Test]
    procedure AnEmailAlreadyRegisteredToAnotherContactInTheHomeCompanyIsRefused()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        ContactA: Record "CG X159 Contact";
        ContactB: Record "CG X159 Contact";
        Result: Boolean;
    begin
        ClearHome();
        CreateContact('C-0030', 'taken.athome@example.com');
        RegisterEmail('taken.athome@example.com', 'C-0030');
        CreateContact('C-0031', 'unrelated@example.com');

        ContactB.Get('C-0031');
        Result := ContactMgt.SaveContact(ContactB, 'taken.athome@example.com');

        ContactB.Get('C-0031');
        ContactA.Get('C-0030');

        Assert.IsFalse(Result,
            'Expected an email already registered to a different contact in the same company to be refused');
        Assert.AreEqual('unrelated@example.com', ContactB.Email,
            'Expected the refused contact''s email to remain unchanged');
        Assert.AreEqual('taken.athome@example.com', ContactA.Email,
            'Expected the original owner''s email to be unaffected by someone else trying to claim it');
    end;

    [Test]
    procedure SavingWithTheEmailAlreadyOnFileSucceedsAndChangesNothing()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
        Result: Boolean;
        RegistrationCountBefore: Integer;
        RegistrationCountAfter: Integer;
    begin
        ClearHome();
        CreateContact('C-0040', 'steady@example.com');
        RegisterEmail('steady@example.com', 'C-0040');
        RegistrationCountBefore := Registry.Count();

        Contact.Get('C-0040');
        Result := ContactMgt.SaveContact(Contact, 'steady@example.com');

        Contact.Get('C-0040');
        RegistrationCountAfter := Registry.Count();

        Assert.IsTrue(Result, 'Expected saving with the same email already on file to succeed');
        Assert.AreEqual('steady@example.com', Contact.Email, 'Expected the email to be exactly what it was before');
        Assert.AreEqual(RegistrationCountBefore, RegistrationCountAfter,
            'Expected saving an unchanged email to neither add nor remove any registration');
    end;

    [Test]
    procedure SavingManyUnchangedEmailsCostsAboutTheSameNoMatterHowManyCompaniesExist()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
        WarmupContact: Record "CG X159 Contact";
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        ContactCount: Integer;
        RegistrationCountAfter: Integer;
        AllSucceeded: Boolean;
        i: Integer;
    begin
        ClearHome();

        // Warm up on disjoint data with a genuinely CHANGED save, so
        // whatever one-time cost that path pays is not attributed to the
        // graded scenario below.
        CreateContact('WARMUP-1', '');
        WarmupContact.Get('WARMUP-1');
        ContactMgt.SaveContact(WarmupContact, 'warmup@example.com');
        ClearHome();

        ContactCount := 200;
        AllSucceeded := true;
        for i := 1 to ContactCount do begin
            CreateContact(SeqCode('PA', i), SeqEmail('PA', i));
            RegisterEmail(SeqEmail('PA', i), SeqCode('PA', i));
        end;

        // Force the seeding writes above to flush before the graded window
        // starts, rather than letting them masquerade as scan cost on the
        // first read inside it.
        Contact.Reset();
        RegistrationCountAfter := Contact.Count();
        Registry.Reset();
        RegistrationCountAfter := Registry.Count();

        StatementsBefore := SessionInformation.SqlStatementsExecuted();

        Contact.Reset();
        Contact.SetRange("No.", SeqCode('PA', 1), SeqCode('PA', ContactCount));
        if Contact.FindSet() then
            repeat
                AllSucceeded := ContactMgt.SaveContact(Contact, Contact.Email) and AllSucceeded;
            until Contact.Next() = 0;

        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        Assert.IsTrue(AllSucceeded, 'Expected every save whose email was not actually changing to succeed');

        Contact.Get(SeqCode('PA', 1));
        Assert.AreEqual(SeqEmail('PA', 1), Contact.Email,
            'Expected the exact right answer before judging its cost - cheap must not mean wrong');
        Contact.Get(SeqCode('PA', ContactCount));
        Assert.AreEqual(SeqEmail('PA', ContactCount), Contact.Email,
            'Expected the exact right answer at the far end of the batch too, before judging its cost');

        RegistrationCountAfter := Registry.Count();
        Assert.AreEqual(ContactCount, RegistrationCountAfter,
            'Expected saving contacts with unchanged emails to add or remove no registrations');

        Assert.IsTrue(StatementsUsed <= 12,
            StrSubstNo('Expected saving %1 contacts whose email is not actually changing to cost about the same no matter how many companies exist to check: budget %2, actual %3', ContactCount, 12, StatementsUsed));

        ClearHome();
    end;

    [Test]
    procedure SavingManyUnchangedEmailsCostsAboutTheSameAtADifferentVolumeToo()
    var
        ContactMgt: Codeunit "CG X159 Contact Mgt";
        Contact: Record "CG X159 Contact";
        Registry: Record "CG X159 Email Registry";
        WarmupContact: Record "CG X159 Contact";
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        ContactCount: Integer;
        RegistrationCountAfter: Integer;
        AllSucceeded: Boolean;
        i: Integer;
    begin
        ClearHome();

        // Same warm-up reasoning as the sibling volume test, at a
        // different contact count so a fix tuned to one specific size
        // cannot pass by coincidence.
        CreateContact('WARMUP-2', '');
        WarmupContact.Get('WARMUP-2');
        ContactMgt.SaveContact(WarmupContact, 'warmup2@example.com');
        ClearHome();

        ContactCount := 300;
        AllSucceeded := true;
        for i := 1 to ContactCount do begin
            CreateContact(SeqCode('PB', i), SeqEmail('PB', i));
            RegisterEmail(SeqEmail('PB', i), SeqCode('PB', i));
        end;

        Contact.Reset();
        RegistrationCountAfter := Contact.Count();
        Registry.Reset();
        RegistrationCountAfter := Registry.Count();

        StatementsBefore := SessionInformation.SqlStatementsExecuted();

        Contact.Reset();
        Contact.SetRange("No.", SeqCode('PB', 1), SeqCode('PB', ContactCount));
        if Contact.FindSet() then
            repeat
                AllSucceeded := ContactMgt.SaveContact(Contact, Contact.Email) and AllSucceeded;
            until Contact.Next() = 0;

        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        Assert.IsTrue(AllSucceeded, 'Expected every save whose email was not actually changing to succeed');

        Contact.Get(SeqCode('PB', 1));
        Assert.AreEqual(SeqEmail('PB', 1), Contact.Email,
            'Expected the exact right answer before judging its cost - cheap must not mean wrong');
        Contact.Get(SeqCode('PB', ContactCount));
        Assert.AreEqual(SeqEmail('PB', ContactCount), Contact.Email,
            'Expected the exact right answer at the far end of the batch too, before judging its cost');

        RegistrationCountAfter := Registry.Count();
        Assert.AreEqual(ContactCount, RegistrationCountAfter,
            'Expected saving contacts with unchanged emails to add or remove no registrations');

        Assert.IsTrue(StatementsUsed <= 18,
            StrSubstNo('Expected saving %1 contacts whose email is not actually changing to cost about the same no matter how many companies exist to check: budget %2, actual %3', ContactCount, 18, StatementsUsed));

        ClearHome();
    end;
}
