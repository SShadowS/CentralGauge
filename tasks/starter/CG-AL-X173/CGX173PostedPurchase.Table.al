table 71573 "CG X173 Posted Purchase"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Requisition No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Vendor No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Vendor Name"; Text[100]) { DataClassification = CustomerContent; }
        field(4; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(5; "Unit Cost"; Decimal) { DataClassification = CustomerContent; }
        field(6; "Discount Pct"; Decimal) { DataClassification = CustomerContent; }
        field(7; "Net Amount"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Requisition No.") { Clustered = true; }
    }
}
