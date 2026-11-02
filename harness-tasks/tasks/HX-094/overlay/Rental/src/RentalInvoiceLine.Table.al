table 70251 "CGR Rental Invoice Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Invoice No."; Code[20]) { TableRelation = "CGR Rental Invoice"; }
        field(2; "Line No."; Integer) { }
        field(3; Description; Text[100]) { }
        field(4; "Tax Group Code"; Code[10]) { }
        field(5; "Line Amount"; Decimal) { }
        field(6; "Discount Amount"; Decimal) { }
    }

    keys
    {
        key(PK; "Invoice No.", "Line No.") { Clustered = true; }
    }
}
