codeunit 89321 "CG-AL-X127 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Companies are enumerated at runtime, never hardcoded. Every
    // cross-company test clears BOTH companies and Commit()s that clear
    // BEFORE it seeds anything, so a failed run always rolls back to a
    // durably clean state (an error rolls back only writes made since the
    // last Commit()). Every cross-company test that reads live state back
    // also clears + Commit()s again, still before any Assert - so a later
    // assertion failure can never strand a row, because it cannot undo a
    // Commit() that already happened.

    var
        Assert: Codeunit Assert;

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

    local procedure ClearHere()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
    begin
        SiteSetup.DeleteAll();
        JobCard.DeleteAll();
    end;

    local procedure ClearThere(OtherName: Text[30])
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.DeleteAll();
    end;

    local procedure SeedHere(SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure SeedThere(OtherName: Text[30]; SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure ReadThere(OtherName: Text[30]; SiteCode: Code[10]; var Found: Boolean; var Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        Found := SiteSetup.Get(SiteCode);
        if Found then
            Restricted := SiteSetup.Restricted;
    end;

    local procedure CountThere(OtherName: Text[30]): Integer
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        exit(SiteSetup.Count());
    end;

    [Test]
    procedure SiteCodeWithNoRestrictionRecordedForThisCompanyValidates()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        SiteCodeAfter: Code[10];
    begin
        OtherName := GetOtherCompanyName();
        ClearHere();
        ClearThere(OtherName);
        Commit();

        SeedHere('DEPOT1', false);
        SeedThere(OtherName, 'DEPOT1', true);

        JobCard.Init();
        JobCard."No." := 'JC001';
        JobCard.Validate("Site Code", 'DEPOT1');
        JobCard.Insert();

        SiteCodeAfter := JobCard."Site Code";

        ClearHere();
        ClearThere(OtherName);
        Commit();

        Assert.AreEqual('DEPOT1', SiteCodeAfter,
            'Expected a site code to validate when no restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure SiteCodeWithARestrictionRecordedForThisCompanyIsRefused()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        ErrorTextAfter: Text;
    begin
        OtherName := GetOtherCompanyName();
        ClearHere();
        ClearThere(OtherName);
        Commit();

        SeedHere('DEPOT2', true);
        SeedThere(OtherName, 'DEPOT2', false);

        JobCard.Init();
        JobCard."No." := 'JC002';

        asserterror JobCard.Validate("Site Code", 'DEPOT2');
        ErrorTextAfter := GetLastErrorText();

        ClearHere();
        ClearThere(OtherName);
        Commit();

        Assert.IsTrue(StrPos(ErrorTextAfter, 'currently restricted') > 0,
            'Expected the site code to be refused when the restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure SiteCodeWithNoRestrictionOnRecordValidates()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        ClearHere();

        SeedHere('DEPOT3', false);

        JobCard.Init();
        JobCard."No." := 'JC003';
        JobCard.Validate("Site Code", 'DEPOT3');
        JobCard.Insert();

        Assert.AreEqual('DEPOT3', JobCard."Site Code",
            'Expected a site code with no restriction on record to validate.');

        ClearHere();
    end;

    [Test]
    procedure ARestrictionOnOneSiteCodeDoesNotAffectAnother()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        ClearHere();

        SeedHere('DEPOT4', true);
        SeedHere('DEPOT5', false);

        JobCard.Init();
        JobCard."No." := 'JC004';
        JobCard.Validate("Site Code", 'DEPOT5');
        JobCard.Insert();

        Assert.AreEqual('DEPOT5', JobCard."Site Code",
            'Expected a different, unrestricted site code to validate regardless of another site code''s own restriction.');

        ClearHere();
    end;

    [Test]
    procedure ValidatingASiteCodeDoesNotChangeDataInAnotherCompany()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        RowCountAfter: Integer;
        FoundAfter: Boolean;
        RestrictedAfter: Boolean;
        RestrictedHereAfter: Boolean;
    begin
        OtherName := GetOtherCompanyName();
        ClearHere();
        ClearThere(OtherName);
        Commit();

        SeedHere('DEPOT7', true);
        SeedThere(OtherName, 'DEPOT6', false);

        JobCard.Init();
        JobCard."No." := 'JC005';
        JobCard.Validate("Site Code", 'DEPOT6');
        JobCard.Insert();

        RowCountAfter := CountThere(OtherName);
        ReadThere(OtherName, 'DEPOT6', FoundAfter, RestrictedAfter);
        SiteSetup.Get('DEPOT7');
        RestrictedHereAfter := SiteSetup.Restricted;

        ClearHere();
        ClearThere(OtherName);
        Commit();

        Assert.AreEqual(1, RowCountAfter,
            'Expected validating a job card not to add or remove records belonging to a different company.');
        Assert.IsTrue(FoundAfter,
            'Expected validating a job card not to remove a record belonging to a different company.');
        Assert.IsFalse(RestrictedAfter,
            'Expected validating a job card not to change data belonging to a different company.');
        Assert.IsTrue(RestrictedHereAfter,
            'Expected validating a job card not to change unrelated data recorded for this company.');
    end;
}
