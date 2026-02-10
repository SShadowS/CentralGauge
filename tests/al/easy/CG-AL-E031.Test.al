codeunit 80031 "CG-AL-E031 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestDefaultsAndInsertTriggers()
    var
        Plan: Record "CG Subscription Plan";
        CodeValue: Code[20];
    begin
        // [SCENARIO] Insert sets defaults and timestamps
        CodeValue := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Plan.Init();
        Plan.Code := CodeValue;
        Plan.Description := 'Test plan';
        Plan.Validate("Monthly Fee", 10.50);
        // Active not set explicitly, Created Date not set explicitly
        Plan.Insert(true);

        Clear(Plan);
        Plan.Get(CodeValue);

        Assert.IsTrue(Plan.Active, 'Active should default to true via InitValue');
        Assert.AreEqual(WorkDate(), Plan."Created Date", 'Created Date should default to WorkDate on insert');
        Assert.AreNotEqual(0DT, Plan."Last Modified DateTime", 'Last Modified DateTime should be set on insert');

        Plan.Active := false;
        Plan.Modify(false);
        Plan.Delete();
    end;

    [Test]
    procedure TestMonthlyFeeNegativeBlocked()
    var
        Plan: Record "CG Subscription Plan";
        CodeValue: Code[20];
    begin
        // [SCENARIO] Negative Monthly Fee is blocked with exact error text
        CodeValue := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Plan.Init();
        Plan.Code := CodeValue;
        Plan.Description := 'Test plan';

        asserterror Plan.Validate("Monthly Fee", -0.01);
        Assert.AreEqual('Monthly Fee cannot be negative', GetLastErrorText(), 'Negative Monthly Fee must be blocked');

        // No insert needed
    end;

    [Test]
    procedure TestDeleteBlockedWhenActiveAndAllowedWhenInactive()
    var
        Plan: Record "CG Subscription Plan";
        CodeValue: Code[20];
    begin
        // [SCENARIO] Active plans cannot be deleted; inactive plans can
        CodeValue := CopyStr(DelChr(Format(CreateGuid()), '=', '{}-'), 1, 20);

        Plan.Init();
        Plan.Code := CodeValue;
        Plan.Description := 'Test plan';
        Plan.Validate("Monthly Fee", 1);
        Plan.Insert(true);
        Commit();

        asserterror Plan.Delete(true);
        Assert.AreEqual('Cannot delete active subscription plan', GetLastErrorText(), 'Active delete must be blocked');

        Plan.Get(CodeValue);
        Plan.Active := false;
        Plan.Modify(true);

        Plan.Delete(true);

        Assert.IsFalse(Plan.Get(CodeValue), 'Plan should be deleted when inactive');
    end;
}
