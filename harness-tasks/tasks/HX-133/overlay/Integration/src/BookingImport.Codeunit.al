codeunit 70407 "CGR Booking Import"
{
    procedure ApplyPartnerEndDates(var PartnerContract: Record "CGR Rental Contract" temporary): Integer
    var
        Contract: Record "CGR Rental Contract";
        Silencer: Codeunit "CGR Integration Silencer";
        Applied: Integer;
    begin
        BindSubscription(Silencer);
        Silencer.SilenceMessages();
        if PartnerContract.FindSet() then
            repeat
                Contract.Get(PartnerContract."No.");
                Contract."End Date" := PartnerContract."End Date";
                Contract.Modify(true);
                Applied += 1;
            until PartnerContract.Next() = 0;
        Silencer.ResumeMessages();
        UnbindSubscription(Silencer);
        exit(Applied);
    end;
}
