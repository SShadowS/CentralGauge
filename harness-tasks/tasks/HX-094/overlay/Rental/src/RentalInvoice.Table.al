table 70250 "CGR Rental Invoice"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; "Customer Name"; Text[100]) { }
        field(3; "Handling Fee"; Decimal) { }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
