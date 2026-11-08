codeunit 70267 "CGR Desk Posting"
{
    var
        LockedErr: Label 'The desk is locked after 3 failed postings. Ask the back office to unlock it.';
        NotReturnedErr: Label 'Rental contract %1 must be returned before it is posted.', Comment = '%1 = contract number';

    procedure PostAtDesk(ContractNo: Code[20])
    var
        Contract: Record "CGR Rental Contract";
        Attempts: Codeunit "CGR Desk Attempts";
        RentalPost: Codeunit "CGR Rental-Post";
    begin
        if Attempts.Failures() >= 3 then
            Error(LockedErr);
        Contract.Get(ContractNo);
        if Contract.Status <> Contract.Status::Returned then begin
            Attempts.AddFailure();
            Error(NotReturnedErr, Contract."No.");
        end;
        RentalPost.Run(Contract);
        Attempts.Reset();
    end;
}
