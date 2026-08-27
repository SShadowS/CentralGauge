codeunit 70420 "CG H042 Consent Gate"
{
    Access = Public;

    procedure CanSendCustomerData(NoticeId: Code[50]): Boolean
    var
        PrivacyNotice: Codeunit "Privacy Notice";
    begin
        exit(PrivacyNotice.GetPrivacyNoticeApprovalState(NoticeId) = Enum::"Privacy Notice Approval State"::Agreed);
    end;
}