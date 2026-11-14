# Feature 5175: Weekly revenue per vehicle

Requested by Fleet controlling.

Controlling plans the fleet week by week, Monday to Sunday, using the week numbers Business Central shows, and today adds up each vehicle's rental ledger entries by hand for every week. They want the weekly figures kept in the new table `CGR Vehicle Week Revenue` (Reporting), which is already there:

```al
// Reporting
table 70576 "CGR Vehicle Week Revenue"
{
    fields
    {
        field(1; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(2; Year; Integer) { }
        field(3; "Week No."; Integer) { }
        field(4; "Week Start"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; "Entry Count"; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.", Year, "Week No.") { Clustered = true; }
    }
}

// Rental (existing)
table 70205 "CGR Rental Ledger Entry"
{
    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { TableRelation = "CGR Rental Contract"; }
        field(3; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(4; "Posting Date"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; "Km Driven"; Integer) { }
    }
}
```

Add codeunit 70577 `CGR Weekly Revenue Mgt` (Reporting) with:

- `procedure BuildWeekRevenue(VehicleNo: Code[20])`
- `procedure GetYearWeeks(VehicleNo: Code[20]; Year: Integer; var WeekBuffer: Record "CGR Vehicle Week Revenue" temporary)`

BuildWeekRevenue replaces the vehicle's rows with one row for each week in which the vehicle has ledger entries: "Week No." is the week's number, Year the year that week number belongs to, "Week Start" the week's Monday, Amount the sum of the week's entries and "Entry Count" their number. The week that spans New Year is reported once, as one row holding all seven of its days, like any other week. GetYearWeeks fills WeekBuffer with one row for every week of Year, from week 1 to the year's last week, with the vehicle's Amount and "Entry Count" from its built rows, and 0 for a week without one.

Write the AL for the new codeunit and explain briefly.
