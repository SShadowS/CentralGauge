codeunit 87957 "HX133 Import Runner"
{
    var
        HX133ContractNo: Code[20];
        HX133EndDate: Date;
        HX133Applied: Integer;

    procedure SetHX133Partner(ContractNo: Code[20]; EndDate: Date)
    begin
        HX133ContractNo := ContractNo;
        HX133EndDate := EndDate;
    end;

    procedure HX133AppliedCount(): Integer
    begin
        exit(HX133Applied);
    end;

    trigger OnRun()
    var
        PartnerContract: Record "CGR Rental Contract" temporary;
        BookingImport: Codeunit "CGR Booking Import";
    begin
        PartnerContract.Init();
        PartnerContract."No." := HX133ContractNo;
        PartnerContract."End Date" := HX133EndDate;
        PartnerContract.Insert();
        HX133Applied := BookingImport.ApplyPartnerEndDates(PartnerContract);
    end;
}
