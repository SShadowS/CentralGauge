table 70261 "CGR Payment Export Line"
{
    DataClassification = CustomerContent;

    // A customer payment as it goes to the accounting partner. Open until the export file is
    // written (Exported), Sent once the partner confirms it.
    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Contract No."; Code[20]) { }
        field(3; Status; Enum "CGR Export Line Status") { }
        field(4; "Applies-to ID"; Code[20]) { }
        field(5; "Currency Code"; Code[10]) { }
        field(6; Amount; Decimal) { }
        field(7; "Amount (LCY)"; Decimal) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
        key(Contract; "Contract No.") { }
    }
}
