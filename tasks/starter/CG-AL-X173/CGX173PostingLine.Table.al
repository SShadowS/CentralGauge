table 71570 "CG X173 Posting Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Requisition No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Vendor No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Item No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; "Unit Cost"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Requisition No.") { Clustered = true; }
    }
}
