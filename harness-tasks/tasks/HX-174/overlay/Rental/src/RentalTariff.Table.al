table 70276 "CGR Rental Tariff"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Code; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; "Daily Rate"; Decimal) { }
    }

    keys
    {
        key(PK; Code) { Clustered = true; }
        key(ByDailyRate; "Daily Rate") { }
    }
}
