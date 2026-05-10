codeunit 80257 "CG-AL-H042 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Gate: Codeunit "CG H042 Consent Gate";

    [Test]
    procedure TestAgreed_ReturnsTrue()
    var
        PrivacyNotice: Codeunit "Privacy Notice";
    begin
        EnsureNoticeRegistered();
        PrivacyNotice.SetApprovalState('CG-H042-NOTICE', "Privacy Notice Approval State"::Agreed);
        Assert.IsTrue(
            Gate.CanSendCustomerData('CG-H042-NOTICE'),
            'CanSendCustomerData must return true when approval state is Agreed.');
    end;

    [Test]
    procedure TestDisagreed_ReturnsFalse()
    var
        PrivacyNotice: Codeunit "Privacy Notice";
    begin
        EnsureNoticeRegistered();
        PrivacyNotice.SetApprovalState('CG-H042-NOTICE', "Privacy Notice Approval State"::Disagreed);
        Assert.IsFalse(
            Gate.CanSendCustomerData('CG-H042-NOTICE'),
            'CanSendCustomerData must return false when approval state is Disagreed.');
    end;

    [Test]
    procedure TestUnregisteredNoticeId_ReturnsFalse()
    begin
        Assert.IsFalse(
            Gate.CanSendCustomerData('NEVER-REGISTERED-XYZ'),
            'CanSendCustomerData must return false when the notice id is not registered.');
    end;

    local procedure EnsureNoticeRegistered()
    var
        PrivacyNoticeRec: Record "Privacy Notice";
    begin
        if PrivacyNoticeRec.Get('CG-H042-NOTICE') then
            exit;
        PrivacyNoticeRec.Init();
        PrivacyNoticeRec.ID := 'CG-H042-NOTICE';
        PrivacyNoticeRec."Integration Service Name" := 'CG H042 Test Service';
        PrivacyNoticeRec.Insert();
    end;
}
